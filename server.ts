import 'dotenv/config';
import express from 'express';
import sql from 'mssql';
import cors from 'cors';
import { spawn } from 'child_process';
import { getAIProvider } from './server/lib/aiProviders.js';
import { readAISettings, mergeAndPersist, type AISettingsFile } from './server/lib/aiSettingsStore.js';
import { buildSystemPrompt, parseAIJson } from './server/lib/aiAnalyze.js';
import { buildVentasExcelBuffer } from './server/lib/excelExport.js';

const app = express();
app.use(cors());
app.use(express.json());

function getSqlConfig(): sql.config {
    const port = parseInt(process.env.DB_PORT ?? '1433', 10);
    return {
        user: process.env.DB_USER ?? 'Axoft',
        password: process.env.DB_PASSWORD ?? '',
        server: process.env.DB_SERVER ?? 'localhost',
        port: Number.isNaN(port) ? 1433 : port,
        database: process.env.DB_DATABASE ?? 'PUNTO_HOGAR_1',
        requestTimeout: 120000,
        connectionTimeout: 60000,
        pool: {
            max: 10,
            min: 2,
            idleTimeoutMillis: 30000
        },
        options: {
            encrypt: false,
            trustServerCertificate: true,
            instanceName: process.env.DB_INSTANCE ?? 'AXSQLSERVER'
        }
    };
}

const config: sql.config = getSqlConfig();

let pool: sql.ConnectionPool | null = null;

async function ensureConnection() {
    if (pool && pool.connected) return pool;
    try {
        pool = await sql.connect(config);
        return pool;
    } catch (err) {
        console.error('[RETAIL] ERROR CRÍTICO DE CONEXIÓN SQL:', err);
        pool = null;
        throw err;
    }
}

// ─── Helper: construye WHERE dinámico usando parámetros SQL nombrados ────────
/** Query params de ventas/dashboard/exportar (tipos múltiples vía ?tipo=a&tipo=b) */
type VentasQueryFilterParams = {
    desde?: string;
    hasta?: string;
    medioPago?: string;
    familia?: string;
    categoria?: string;
    sucursales?: string[];
    proveedores?: string[];
    tipos?: string[];
    generos?: string[];
    cliente?: string;
};

function buildWhere(
    request: any,
    params: VentasQueryFilterParams
): string {
    const clauses: string[] = [];

    if (params.desde && params.hasta) {
        request.input('desde', sql.Date, params.desde);
        request.input('hasta', sql.Date, params.hasta);
        clauses.push('Fecha BETWEEN @desde AND @hasta');
    } else if (params.desde) {
        request.input('desde', sql.Date, params.desde);
        clauses.push('Fecha >= @desde');
    } else if (params.hasta) {
        request.input('hasta', sql.Date, params.hasta);
        clauses.push('Fecha <= @hasta');
    }

    if (params.medioPago) {
        request.input('medioPago', sql.NVarChar, params.medioPago);
        clauses.push('[Medio de Pago] = @medioPago');
    }
    if (params.familia) {
        request.input('familia', sql.NVarChar, params.familia);
        clauses.push('[Familia] = @familia');
    }
    if (params.categoria) {
        request.input('categoria', sql.NVarChar, params.categoria);
        clauses.push('[Categoria] = @categoria');
    }
    // Proveedores: soporta N valores → IN (@p0, @p1, ...)
    if (params.proveedores && params.proveedores.length > 0) {
        if (params.proveedores.length === 1) {
            request.input('proveedor0', sql.NVarChar, String(params.proveedores[0]));
            clauses.push('[PROVEEDOR (Adic.)] = @proveedor0');
        } else {
            const placeholders = params.proveedores.map((p, i) => {
                request.input(`proveedor${i}`, sql.NVarChar, String(p));
                return `@proveedor${i}`;
            }).join(', ');
            clauses.push(`[PROVEEDOR (Adic.)] IN (${placeholders})`);
        }
    }

    // Sucursales: soporta N valores → IN (@s0, @s1, ...)
    if (params.sucursales && params.sucursales.length > 0) {
        if (params.sucursales.length === 1) {
            request.input('sucursal0', sql.NVarChar, String(params.sucursales[0]));
            clauses.push('[Nro. Sucursal] = @sucursal0');
        } else {
            const placeholders = params.sucursales.map((s, i) => {
                request.input(`sucursal${i}`, sql.NVarChar, String(s));
                return `@sucursal${i}`;
            }).join(', ');
            clauses.push(`[Nro. Sucursal] IN (${placeholders})`);
        }
    }

    if (params.tipos && params.tipos.length > 0) {
        if (params.tipos.length === 1) {
            request.input('tipo0', sql.NVarChar, String(params.tipos[0]));
            clauses.push('[TIPO (Adic.)] = @tipo0');
        } else {
            const placeholders = params.tipos.map((t, i) => {
                request.input(`tipo${i}`, sql.NVarChar, String(t));
                return `@tipo${i}`;
            }).join(', ');
            clauses.push(`[TIPO (Adic.)] IN (${placeholders})`);
        }
    }
    if (params.generos && params.generos.length > 0) {
        if (params.generos.length === 1) {
            request.input('genero0', sql.NVarChar, String(params.generos[0]));
            clauses.push('[GENERO (Adic.)] = @genero0');
        } else {
            const placeholders = params.generos.map((g, i) => {
                request.input(`genero${i}`, sql.NVarChar, String(g));
                return `@genero${i}`;
            }).join(', ');
            clauses.push(`[GENERO (Adic.)] IN (${placeholders})`);
        }
    }
    const clienteTrim = params.cliente?.trim();
    if (clienteTrim) {
        request.input('clienteCod', sql.NVarChar, clienteTrim);
        clauses.push('[Cód. Cliente] = @clienteCod');
    }

    return clauses.length ? `WHERE ${clauses.join(' AND ')}` : '';
}

/** Parsea arrays (?tipo=a&tipo=b) y cliente desde req.query */
function parseVentasQueryArrays(q: Record<string, string | string[] | undefined>) {
    const asStrArray = (key: string): string[] => {
        const v = q[key];
        if (Array.isArray(v)) return v.map(String);
        return v != null && String(v) !== '' ? [String(v)] : [];
    };
    const clienteQ = q.cliente;
    const clienteRaw = Array.isArray(clienteQ)
        ? String(clienteQ[0] ?? '').trim()
        : clienteQ != null ? String(clienteQ).trim() : '';
    return {
        sucursales: asStrArray('sucursal'),
        provArray: asStrArray('proveedor'),
        tipoArray: asStrArray('tipo'),
        generoArray: asStrArray('genero'),
        cliente: clienteRaw,
    };
}

function ventasFilterPayloadFromQuery(q: Record<string, string | string[] | undefined>): VentasQueryFilterParams {
    const ar = parseVentasQueryArrays(q);
    return {
        desde: q.desde as string | undefined,
        hasta: q.hasta as string | undefined,
        medioPago: q.medioPago as string | undefined,
        familia: q.familia as string | undefined,
        categoria: q.categoria as string | undefined,
        proveedores: ar.provArray,
        sucursales: ar.sucursales,
        tipos: ar.tipoArray,
        generos: ar.generoArray,
        cliente: ar.cliente,
    };
}

/** Cláusulas Tipo / Género / Cliente con parámetros (mismo patrón que buildWhere) para requests manuales (comparativo, count). */
function appendTipoGeneroClienteClauses(
    request: sql.Request,
    tipoArray: string[],
    generoArray: string[],
    cliente: string
): string[] {
    const clauses: string[] = [];
    if (tipoArray.length === 1) {
        request.input('tipo0', sql.NVarChar, String(tipoArray[0]));
        clauses.push('[TIPO (Adic.)] = @tipo0');
    } else if (tipoArray.length > 1) {
        tipoArray.forEach((t, i) => request.input(`tipo${i}`, sql.NVarChar, String(t)));
        clauses.push(`[TIPO (Adic.)] IN (${tipoArray.map((_, i) => `@tipo${i}`).join(', ')})`);
    }
    if (generoArray.length === 1) {
        request.input('genero0', sql.NVarChar, String(generoArray[0]));
        clauses.push('[GENERO (Adic.)] = @genero0');
    } else if (generoArray.length > 1) {
        generoArray.forEach((g, i) => request.input(`genero${i}`, sql.NVarChar, String(g)));
        clauses.push(`[GENERO (Adic.)] IN (${generoArray.map((_, i) => `@genero${i}`).join(', ')})`);
    }
    if (cliente) {
        request.input('clienteCod', sql.NVarChar, cliente);
        clauses.push('[Cód. Cliente] = @clienteCod');
    }
    return clauses;
}


// ─── Columnas para el detalle ─────────────────────────────────────────────────
const VENTAS_COLUMNS = `
    FORMAT(Dashboard_Ventas_Local.[Fecha], 'yyyy-MM-dd') AS Fecha,
    [Nro. Sucursal], [Tipo de comprobante], [Nro. Comprobante],
    [Cód. vendedor], [Cód. Artículo], [Descripción], CTA_ARTICULO.DESC_ADICIONAL_ARTICULO AS DescripcionAdicional,
    [Medio de Pago],[Precio Neto], [Precio Unitario], [Total cIVA],
    [Familia], [Categoria], [TIPO (Adic.)], [GENERO (Adic.)], [Cantidad], [PROVEEDOR (Adic.)], [PR.ÚLT.CPA C/IVA] AS CostoUnitario`;
/* ── PENDIENTE: agregar [Precio Neto] cuando el ALTER VIEW sea ejecutado en SQL Server ── */





/**
 * GET /api/ventas
 * Query params: desde, hasta, medioPago, familia, categoria, page (0-based), limit (default 500)
 * Devuelve { data: [], total: N } con paginación server-side.
 */
app.get('/api/ventas', async (req, res) => {
    try {
        const rawQ = req.query as Record<string, string | string[] | undefined>;
        const q = rawQ as Record<string, string | undefined>;
        const page = Math.max(0, parseInt(q.page ?? '0', 10));
        const limit = Math.min(2000, Math.max(1, parseInt(q.limit ?? '500', 10)));
        const offset = page * limit;

        const pool = await ensureConnection();
        const { sucursales: sucArray, provArray, tipoArray, generoArray, cliente: clienteCod } = parseVentasQueryArrays(rawQ);
        const filtros = ventasFilterPayloadFromQuery(rawQ);

        const incluirComparativo = q.incluirPeriodoAnterior === '1' && q.desde && q.hasta;

        // ── Stats y datos según modo: normal o comparativo (desde_anterior hasta hasta) ──
        let total: number;
        let totalImporteGlobal: number;
        let dataRows: any[];

        if (incluirComparativo) {
            const compReq = pool.request();
            compReq.input('desde', sql.Date, q.desde);
            compReq.input('hasta', sql.Date, q.hasta);
            if (q.medioPago) { compReq.input('medioPago', sql.NVarChar, q.medioPago); }
            if (q.familia) { compReq.input('familia', sql.NVarChar, q.familia); }
            if (q.categoria) { compReq.input('categoria', sql.NVarChar, q.categoria); }
            if (provArray.length === 1) compReq.input('proveedor0', sql.NVarChar, provArray[0]);
            else if (provArray.length > 1) provArray.forEach((p, i) => compReq.input(`proveedor${i}`, sql.NVarChar, p));
            const sucClauses: string[] = [];
            if (sucArray.length === 1) {
                compReq.input('sucursal0', sql.NVarChar, sucArray[0]);
                sucClauses.push('[Nro. Sucursal] = @sucursal0');
            } else if (sucArray.length > 1) {
                sucArray.forEach((s, i) => compReq.input(`sucursal${i}`, sql.NVarChar, s));
                sucClauses.push(`[Nro. Sucursal] IN (${sucArray.map((_, i) => `@sucursal${i}`).join(', ')})`);
            }
            const tgcClauses = appendTipoGeneroClienteClauses(compReq, tipoArray, generoArray, clienteCod);
            const compWhereActual = [
                'Fecha BETWEEN @desde AND @hasta',
                ...(q.medioPago ? ['[Medio de Pago] = @medioPago'] : []),
                ...(q.familia ? ['[Familia] = @familia'] : []),
                ...(q.categoria ? ['[Categoria] = @categoria'] : []),
                ...(provArray.length > 0 ? (provArray.length === 1 ? ['[PROVEEDOR (Adic.)] = @proveedor0'] : [`[PROVEEDOR (Adic.)] IN (${provArray.map((_, i) => `@proveedor${i}`).join(', ')})`]) : []),
                ...sucClauses,
                ...tgcClauses,
            ].filter(Boolean).join(' AND ');

            const compWhereAnterior = [
                'Fecha BETWEEN DATEADD(month, -1, @desde) AND DATEADD(month, -1, @hasta)',
                ...(q.medioPago ? ['[Medio de Pago] = @medioPago'] : []),
                ...(q.familia ? ['[Familia] = @familia'] : []),
                ...(q.categoria ? ['[Categoria] = @categoria'] : []),
                ...(provArray.length > 0 ? (provArray.length === 1 ? ['[PROVEEDOR (Adic.)] = @proveedor0'] : [`[PROVEEDOR (Adic.)] IN (${provArray.map((_, i) => `@proveedor${i}`).join(', ')})`]) : []),
                ...sucClauses,
                ...tgcClauses,
            ].filter(Boolean).join(' AND ');

            const compLimit = 5000;
            compReq.input('compOffset', sql.Int, 0);
            compReq.input('compLimit', sql.Int, compLimit);

            const compResult = await compReq.query(`
                SELECT * FROM (
                    SELECT TOP (@compLimit) ${VENTAS_COLUMNS}, 'actual' AS periodo_comparativo
                    FROM Dashboard_Ventas_Local
                    LEFT JOIN CTA_ARTICULO ON Dashboard_Ventas_Local.[Cód. Artículo] COLLATE DATABASE_DEFAULT = CTA_ARTICULO.COD_CTA_ARTICULO COLLATE DATABASE_DEFAULT
                    WHERE ${compWhereActual}
                    ORDER BY Fecha DESC
                ) A
                UNION ALL
                SELECT * FROM (
                    SELECT TOP (@compLimit) ${VENTAS_COLUMNS}, 'anterior' AS periodo_comparativo
                    FROM Dashboard_Ventas_Local
                    LEFT JOIN CTA_ARTICULO ON Dashboard_Ventas_Local.[Cód. Artículo] COLLATE DATABASE_DEFAULT = CTA_ARTICULO.COD_CTA_ARTICULO COLLATE DATABASE_DEFAULT
                    WHERE ${compWhereAnterior}
                    ORDER BY Fecha DESC
                ) B
            `);
            dataRows = compResult.recordset as any[];
            // Diagnóstico: primeros 5 registros con periodo_comparativo
            const sample = (dataRows as any[]).slice(0, 5);
            const anteriorCount = (dataRows as any[]).filter((r: any) =>
                (r.periodo_comparativo || r.periodo_Comparativo || r.PERIODO_COMPARATIVO) === 'anterior'
            ).length;
            console.log('[RETAIL] /api/ventas comparativo — sample:', JSON.stringify(sample.map((r: any) => ({
                Fecha: r.Fecha,
                'Nro. Sucursal': r['Nro. Sucursal'],
                periodo_comparativo: r.periodo_comparativo ?? r.periodo_Comparativo ?? r.PERIODO_COMPARATIVO ?? '??',
            })), null, 0));
            console.log('[RETAIL] /api/ventas comparativo — filas con periodo=anterior:', anteriorCount, '/', dataRows.length);

            const countReq = pool.request();
            countReq.input('desde', sql.Date, q.desde);
            countReq.input('hasta', sql.Date, q.hasta);
            if (q.medioPago) countReq.input('medioPago', sql.NVarChar, q.medioPago);
            if (q.familia) countReq.input('familia', sql.NVarChar, q.familia);
            if (q.categoria) countReq.input('categoria', sql.NVarChar, q.categoria);
            if (provArray.length === 1) countReq.input('proveedor0', sql.NVarChar, provArray[0]);
            else if (provArray.length > 1) provArray.forEach((p, i) => countReq.input(`proveedor${i}`, sql.NVarChar, p));
            if (sucArray.length === 1) countReq.input('sucursal0', sql.NVarChar, sucArray[0]);
            else if (sucArray.length > 1) sucArray.forEach((s, i) => countReq.input(`sucursal${i}`, sql.NVarChar, s));
            appendTipoGeneroClienteClauses(countReq, tipoArray, generoArray, clienteCod);
            const countRes = await countReq.query(`
                SELECT COUNT(*) AS total, SUM([Total cIVA]) AS totalImporteGlobal
                FROM Dashboard_Ventas_Local
                WHERE ${compWhereActual}
            `);
            total = Number(countRes.recordset[0]?.total ?? 0);
            totalImporteGlobal = Number(countRes.recordset[0]?.totalImporteGlobal ?? 0);
        } else {
            const statsReq = pool.request();
            const whereStats = buildWhere(statsReq, filtros);
            const statsResult = await statsReq.query(`
                SELECT COUNT(*) AS total, SUM([Total cIVA]) AS totalImporteGlobal
                FROM Dashboard_Ventas_Local ${whereStats}
            `);
            total = Number(statsResult.recordset[0]?.total ?? 0);
            totalImporteGlobal = Number(statsResult.recordset[0]?.totalImporteGlobal ?? 0);

            const dataReq = pool.request();
            const whereData = buildWhere(dataReq, filtros);
            dataReq.input('offset', sql.Int, offset);
            dataReq.input('limit', sql.Int, limit);

            const dataResult = await dataReq.query(`
                SELECT ${VENTAS_COLUMNS}
                FROM Dashboard_Ventas_Local
                LEFT JOIN CTA_ARTICULO ON Dashboard_Ventas_Local.[Cód. Artículo] COLLATE DATABASE_DEFAULT = CTA_ARTICULO.COD_CTA_ARTICULO COLLATE DATABASE_DEFAULT
                ${whereData}
                ORDER BY Fecha DESC
                OFFSET @offset ROWS FETCH NEXT @limit ROWS ONLY
            `);
            dataRows = (dataResult.recordset as any[]).map(r => ({ ...r, periodo_comparativo: 'actual' }));
        }

        console.log(`[RETAIL] /api/ventas page=${page} limit=${limit} → ${dataRows.length}/${total} ($${totalImporteGlobal.toFixed(0)})${incluirComparativo ? ' [comparativo]' : ''}`);
        if (incluirComparativo && dataRows.length > 0) {
            console.log('[RETAIL] /api/ventas — payload sample (primeros 3):', JSON.stringify((dataRows as any[]).slice(0, 3).map((r: any) => ({
                ...r,
                periodo_comparativo: r.periodo_comparativo ?? r.periodo_Comparativo ?? '(no presente)',
            })), null, 0).slice(0, 600));
        }
        res.json({
            data: dataRows,
            total,
            page,
            limit,
            meta: { totalImporteGlobal },
        });

    } catch (err) {
        console.error('[RETAIL] Error SQL /api/ventas:', err);
        res.status(500).json({ error: String(err) });
    }
});

/**
 * GET /api/ventas/exportar
 * Mismos query params de filtro que GET /api/ventas — devuelve .xlsx (exceljs).
 */
app.get('/api/ventas/exportar', async (req, res) => {
    try {
        const rawQ = req.query as Record<string, string | string[] | undefined>;
        const pool = await ensureConnection();

        const dataReq = pool.request();
        const whereData = buildWhere(dataReq, ventasFilterPayloadFromQuery(rawQ));

        const dataResult = await dataReq.query(`
            SELECT ${VENTAS_COLUMNS}
            FROM Dashboard_Ventas_Local
            LEFT JOIN CTA_ARTICULO ON Dashboard_Ventas_Local.[Cód. Artículo] COLLATE DATABASE_DEFAULT = CTA_ARTICULO.COD_CTA_ARTICULO COLLATE DATABASE_DEFAULT
            ${whereData}
            ORDER BY Fecha DESC
        `);

        const rows = (dataResult.recordset ?? []) as Record<string, unknown>[];
        const buffer = await buildVentasExcelBuffer(rows);
        const fname = `ventas_${new Date().toISOString().slice(0, 10)}.xlsx`;
        res.setHeader('Content-Type', 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet');
        res.setHeader('Content-Disposition', `attachment; filename="${fname}"`);
        res.send(buffer);
        console.log(`[RETAIL] /api/ventas/exportar → ${rows.length} filas`);
    } catch (err) {
        console.error('[RETAIL] Error SQL /api/ventas/exportar:', err);
        res.status(500).json({ error: String(err) });
    }
});

/**
 * GET /api/stock
 * Obtiene saldos de stock por artículo, sucursal y depósito.
 * Incluye campos adicionales de STA11 y costo PPP.
 */
app.get('/api/stock', async (req, res) => {
    console.log('[RETAIL] /api/stock: Buscando saldos de inventario...');
    try {
        const q = req.query as Record<string, string | string[] | undefined>;
        const pool = await ensureConnection();
        const request = pool.request();

        // ── Rango de fechas para ventas dinámicas ───────────────────────────
        const today = new Date();
        const thirtyDaysAgo = new Date(today);
        thirtyDaysAgo.setDate(today.getDate() - 30);

        const fechaDesde = q.fechaDesde as string || thirtyDaysAgo.toISOString().split('T')[0];
        const fechaHasta = q.fechaHasta as string || today.toISOString().split('T')[0];

        request.input('fechaDesde', sql.Date, fechaDesde);
        request.input('fechaHasta', sql.Date, fechaHasta);
        
        // Filtro por sucursal (opcional)
        const sucArray = Array.isArray(q.sucursal)
            ? (q.sucursal as string[])
            : q.sucursal ? [q.sucursal as string] : [];
        
        let whereSucursal = '';
        if (sucArray.length > 0) {
            const placeholders = sucArray.map((s, i) => {
                request.input(`stock_sucursal${i}`, sql.NVarChar, String(s));
                return `@stock_sucursal${i}`;
            }).join(', ');
            whereSucursal = `AND SUCURSAL.NRO_SUCURSAL IN (${placeholders})`;
        }

        const query = `
            SET TRANSACTION ISOLATION LEVEL READ UNCOMMITTED;
            SET DATEFORMAT DMY;
            SET DATEFIRST 7;
            SET DEADLOCK_PRIORITY -8;
            
            SELECT TOP 5000
                CTA_ARTICULO.COD_CTA_ARTICULO AS [cod_art],
                CTA_ARTICULO.DESC_CTA_ARTICULO AS [descripcion],
                CTA_ARTICULO.DESC_ADICIONAL_ARTICULO AS DescripcionAdicional,
                SUCURSAL.NRO_SUCURSAL AS [nro_sucursal],
                SUCURSAL.DESC_SUCURSAL AS [sucursal],
                CTA_DEPOSITO.COD_CTA_DEPOSITO AS [cod_deposito],
                CTA_DEPOSITO.DESC_CTA_DEPOSITO AS [deposito],
                MEDIDA_STOCK.SIGLA_MEDIDA AS [um_stock],
                SUM(CTA_SALDO_ARTICULO_DEPOSITO.CANTIDAD_STOCK) AS [saldo],
                
                -- Extracción de campos adicionales de STA11
                (CASE WHEN CHARINDEX('<CA_FAMILIA>', CAST(STA11.CAMPOS_ADICIONALES as NVARCHAR(MAX))) = 0 THEN '' ELSE (SUBSTRING( CAST(STA11.CAMPOS_ADICIONALES as NVARCHAR(MAX)),CHARINDEX('<CA_FAMILIA>', CAST(STA11.CAMPOS_ADICIONALES as NVARCHAR(MAX))) + LEN('<CA_FAMILIA>'),CHARINDEX('</CA_FAMILIA>', CAST(STA11.CAMPOS_ADICIONALES as NVARCHAR(MAX))) - (CHARINDEX('<CA_FAMILIA>', CAST(STA11.CAMPOS_ADICIONALES as NVARCHAR(MAX))) + LEN('<CA_FAMILIA>')))) END) AS [familia],
                (CASE WHEN CHARINDEX('<CA_CATEGORIA>', CAST(STA11.CAMPOS_ADICIONALES as NVARCHAR(MAX))) = 0 THEN '' ELSE (SUBSTRING( CAST(STA11.CAMPOS_ADICIONALES as NVARCHAR(MAX)),CHARINDEX('<CA_CATEGORIA>', CAST(STA11.CAMPOS_ADICIONALES as NVARCHAR(MAX))) + LEN('<CA_CATEGORIA>'),CHARINDEX('</CA_CATEGORIA>', CAST(STA11.CAMPOS_ADICIONALES as NVARCHAR(MAX))) - (CHARINDEX('<CA_CATEGORIA>', CAST(STA11.CAMPOS_ADICIONALES as NVARCHAR(MAX))) + LEN('<CA_CATEGORIA>')))) END) AS [categoria],
                (CASE WHEN CHARINDEX('<CA_PROVEEDOR>', CAST(STA11.CAMPOS_ADICIONALES as NVARCHAR(MAX))) = 0 THEN '' ELSE (SUBSTRING( CAST(STA11.CAMPOS_ADICIONALES as NVARCHAR(MAX)),CHARINDEX('<CA_PROVEEDOR>', CAST(STA11.CAMPOS_ADICIONALES as NVARCHAR(MAX))) + LEN('<CA_PROVEEDOR>'),CHARINDEX('</CA_PROVEEDOR>', CAST(STA11.CAMPOS_ADICIONALES as NVARCHAR(MAX))) - (CHARINDEX('<CA_PROVEEDOR>', CAST(STA11.CAMPOS_ADICIONALES as NVARCHAR(MAX))) + LEN('<CA_PROVEEDOR>')))) END) AS [proveedor],
                (CASE WHEN CHARINDEX('<CA_TIPO>', CAST(STA11.CAMPOS_ADICIONALES as NVARCHAR(MAX))) = 0 THEN '' ELSE (SUBSTRING( CAST(STA11.CAMPOS_ADICIONALES as NVARCHAR(MAX)),CHARINDEX('<CA_TIPO>', CAST(STA11.CAMPOS_ADICIONALES as NVARCHAR(MAX))) + LEN('<CA_TIPO>'),CHARINDEX('</CA_TIPO>', CAST(STA11.CAMPOS_ADICIONALES as NVARCHAR(MAX))) - (CHARINDEX('<CA_TIPO>', CAST(STA11.CAMPOS_ADICIONALES as NVARCHAR(MAX))) + LEN('<CA_TIPO>')))) END) AS [tipo_art],
                (CASE WHEN CHARINDEX('<CA_GENERO>', CAST(STA11.CAMPOS_ADICIONALES as NVARCHAR(MAX))) = 0 THEN '' ELSE (SUBSTRING( CAST(STA11.CAMPOS_ADICIONALES as NVARCHAR(MAX)),CHARINDEX('<CA_GENERO>', CAST(STA11.CAMPOS_ADICIONALES as NVARCHAR(MAX))) + LEN('<CA_GENERO>'),CHARINDEX('</CA_GENERO>', CAST(STA11.CAMPOS_ADICIONALES as NVARCHAR(MAX))) - (CHARINDEX('<CA_GENERO>', CAST(STA11.CAMPOS_ADICIONALES as NVARCHAR(MAX))) + LEN('<CA_GENERO>')))) END) AS [genero],
                
                -- Costo Unitario valora compras + IVA DINÁMICO (MINI CASE)
                MAX(ISNULL(STA12.PRECIO_U_L, 0) * (CASE WHEN STA11.COD_IVA = 3 THEN 1.105 ELSE 1.21 END)) AS CostoUnitario,
                -- Fecha de Última Compra
                MAX(STA12.FECHA_ULC) AS FechaUltimaCompra,

                -- Ventas Dinámicas del Período
                MAX(ISNULL(STATS_LOCAL.TotalVendido, 0)) AS totalVendido,
                MAX(ISNULL(STATS_GRAL.TotalVendido, 0)) AS totalVendidoGral

            FROM
                CTA_SALDO_ARTICULO_DEPOSITO 
                RIGHT JOIN (
                    SELECT ID_CTA_ARTICULO, ID_CTA_DEPOSITO, ID_SUCURSAL, MAX(FECHA) AS [FECHA_MAX] 
                    FROM CTA_SALDO_ARTICULO_DEPOSITO 
                    GROUP BY ID_CTA_ARTICULO, ID_CTA_DEPOSITO, ID_SUCURSAL
                ) AS ULT_SALDO ON (
                    CTA_SALDO_ARTICULO_DEPOSITO.ID_CTA_ARTICULO = ULT_SALDO.ID_CTA_ARTICULO 
                    AND CTA_SALDO_ARTICULO_DEPOSITO.ID_CTA_DEPOSITO = ULT_SALDO.ID_CTA_DEPOSITO 
                    AND CTA_SALDO_ARTICULO_DEPOSITO.ID_SUCURSAL = ULT_SALDO.ID_SUCURSAL 
                    AND CTA_SALDO_ARTICULO_DEPOSITO.FECHA = ULT_SALDO.FECHA_MAX
                )
                LEFT JOIN CTA_ARTICULO ON (CTA_SALDO_ARTICULO_DEPOSITO.ID_CTA_ARTICULO = CTA_ARTICULO.ID_CTA_ARTICULO)
                LEFT JOIN STA11 ON (CTA_ARTICULO.COD_CTA_ARTICULO COLLATE DATABASE_DEFAULT = STA11.COD_ARTICU COLLATE DATABASE_DEFAULT)
                LEFT JOIN STA12 ON (STA11.COD_ARTICU COLLATE DATABASE_DEFAULT = STA12.COD_ARTICU COLLATE DATABASE_DEFAULT)
                LEFT JOIN SUCURSAL ON (CTA_SALDO_ARTICULO_DEPOSITO.ID_SUCURSAL = SUCURSAL.ID_SUCURSAL)
                LEFT JOIN CTA_DEPOSITO ON (CTA_SALDO_ARTICULO_DEPOSITO.ID_CTA_DEPOSITO = CTA_DEPOSITO.ID_CTA_DEPOSITO)
                LEFT JOIN CTA_ARTICULO_SUCURSAL ON (
                    CTA_SALDO_ARTICULO_DEPOSITO.ID_CTA_ARTICULO = CTA_ARTICULO_SUCURSAL.ID_CTA_ARTICULO 
                    AND CTA_SALDO_ARTICULO_DEPOSITO.ID_SUCURSAL = CTA_ARTICULO_SUCURSAL.ID_SUCURSAL
                )
                LEFT JOIN CTA_MEDIDA AS MEDIDA_STOCK ON (CTA_ARTICULO_SUCURSAL.ID_CTA_MEDIDA_STOCK = MEDIDA_STOCK.ID_CTA_MEDIDA)
                LEFT JOIN (
                    SELECT COD_ARTICU, NRO_SUCURS, SUM(CANTIDAD) as TotalVendido
                    FROM CTA03
                    WHERE FECHA_MOV BETWEEN @fechaDesde AND @fechaHasta
                    GROUP BY COD_ARTICU, NRO_SUCURS
                ) AS STATS_LOCAL ON (
                    STA11.COD_ARTICU COLLATE DATABASE_DEFAULT = STATS_LOCAL.COD_ARTICU COLLATE DATABASE_DEFAULT
                    AND SUCURSAL.NRO_SUCURSAL = STATS_LOCAL.NRO_SUCURS
                )
                LEFT JOIN (
                    SELECT COD_ARTICU, SUM(CANTIDAD) as TotalVendido
                    FROM CTA03
                    WHERE FECHA_MOV BETWEEN @fechaDesde AND @fechaHasta
                    GROUP BY COD_ARTICU
                ) AS STATS_GRAL ON (
                    STA11.COD_ARTICU COLLATE DATABASE_DEFAULT = STATS_GRAL.COD_ARTICU COLLATE DATABASE_DEFAULT
                )
            WHERE 
                CTA_ARTICULO.STOCK = 1 
                ${whereSucursal}
            GROUP BY
                CTA_ARTICULO.COD_CTA_ARTICULO, 
                CTA_ARTICULO.DESC_CTA_ARTICULO, 
                CTA_ARTICULO.DESC_ADICIONAL_ARTICULO,
                SUCURSAL.NRO_SUCURSAL, 
                SUCURSAL.DESC_SUCURSAL, 
                CTA_DEPOSITO.COD_CTA_DEPOSITO, 
                CTA_DEPOSITO.DESC_CTA_DEPOSITO, 
                MEDIDA_STOCK.SIGLA_MEDIDA,
                CAST(STA11.CAMPOS_ADICIONALES AS NVARCHAR(MAX))
            HAVING 
                SUM(CTA_SALDO_ARTICULO_DEPOSITO.CANTIDAD_STOCK) > 0
            ORDER BY 
                CTA_ARTICULO.COD_CTA_ARTICULO
        `;

        const result = await request.query(query);
        console.log(`[RETAIL] /api/stock → ${result.recordset.length} filas`);
        res.json({ data: result.recordset });
    } catch (err) {
        console.error('[RETAIL] Error SQL /api/stock:', err);
        res.status(500).json({ error: String(err) });
    }
});

app.get('/api/saldos-cajas', async (req, res) => {
    try {
        const pool = await ensureConnection();
        const query = `
            WITH UltimosSaldos AS (
                SELECT
                    S.NRO_SUCURSAL AS [NRO. SUCURSAL],
                    T.COD_CTA_CUENTA_TESORERIA AS [COD. CUENTA],
                    T.DESC_CTA_CUENTA_TESORERIA AS [DESC. CUENTA],
                    ST.SALDO_CORRIENTE AS [SALDO],
                    CONVERT(VARCHAR(10), ST.FECHA_IMPORTACION, 120) AS [FECHA_ACTUALIZACION],
                    ROW_NUMBER() OVER (PARTITION BY S.NRO_SUCURSAL, T.COD_CTA_CUENTA_TESORERIA ORDER BY ST.FECHA_IMPORTACION DESC) as rn
                FROM CTA_SALDO_CUENTA_TESORERIA ST
                LEFT JOIN CTA_CUENTA_TESORERIA T ON T.ID_CTA_CUENTA_TESORERIA = ST.ID_CTA_CUENTA_TESORERIA
                LEFT JOIN SUCURSAL S ON ST.ID_SUCURSAL = S.ID_SUCURSAL
                WHERE (S.NRO_SUCURSAL = 1004 AND T.COD_CTA_CUENTA_TESORERIA = 11010)
                   OR (S.NRO_SUCURSAL = 1017 AND T.COD_CTA_CUENTA_TESORERIA = 11050)
                   OR (S.NRO_SUCURSAL = 1002 AND T.COD_CTA_CUENTA_TESORERIA = 11020)
                   OR (S.NRO_SUCURSAL = 1008 AND T.COD_CTA_CUENTA_TESORERIA = 11000)
                   OR (S.NRO_SUCURSAL = 1014 AND T.COD_CTA_CUENTA_TESORERIA = 11040)
                   OR (S.NRO_SUCURSAL = 1018 AND T.COD_CTA_CUENTA_TESORERIA = 11070)
                   OR (S.NRO_SUCURSAL = 1019 AND T.COD_CTA_CUENTA_TESORERIA = 11060)
                   OR (S.NRO_SUCURSAL = 1015 AND T.COD_CTA_CUENTA_TESORERIA = 11030)
                   OR (S.NRO_SUCURSAL = 1001 AND T.COD_CTA_CUENTA_TESORERIA = 11200)
            )
            SELECT [NRO. SUCURSAL], [COD. CUENTA], [DESC. CUENTA], [SALDO], [FECHA_ACTUALIZACION]
            FROM UltimosSaldos WHERE rn = 1 ORDER BY [NRO. SUCURSAL]
        `;
        const result = await pool.request().query(query);
        console.log(`[RETAIL] /api/saldos-cajas → ${result.recordset.length} filas`);
        res.json(result.recordset);
    } catch (err) {
        console.error('[RETAIL] Error SQL /api/saldos-cajas:', err);
        res.status(500).json({ error: String(err) });
    }
});

/**
 * GET /api/ventas/stats
 * Mismos query params que /api/ventas (sin page/limit).
 * Devuelve totales agregados para gráficos sin enviar el detalle completo.
 */
app.get('/api/ventas/stats', async (req, res) => {
    try {
        const q = req.query as Record<string, string | string[] | undefined>;
        const pool = await ensureConnection();
        const request = pool.request();
        const where = buildWhere(request, ventasFilterPayloadFromQuery(q));

        const result = await request.query(`
            SELECT
                SUM([Total cIVA])                       AS totalFacturado,
                SUM([Cantidad])                         AS cantidadTotal,
                COUNT(*)                                AS filasTotales,
                COUNT(DISTINCT [Nro. Comprobante])      AS voucherCount,
                COUNT(DISTINCT [Nro. Sucursal])         AS sucursales,
                MIN(Fecha)                              AS fechaMin,
                MAX(Fecha)                              AS fechaMax
            FROM Dashboard_Ventas_Local
            ${where}
        `);

        const row = result.recordset[0] ?? {};
        console.log(`[RETAIL] /api/ventas/stats → facturado=${row.totalFacturado}, filas=${row.filasTotales}`);
        res.json({
            totalFacturado: Number(row.totalFacturado ?? 0),
            cantidadTotal: Number(row.cantidadTotal ?? 0),
            filasTotales: Number(row.filasTotales ?? 0),
            voucherCount: Number(row.voucherCount ?? 0),
            sucursales: Number(row.sucursales ?? 0),
            fechaMin: row.fechaMin ?? null,
            fechaMax: row.fechaMax ?? null,
        });

    } catch (err) {
        console.error('[RETAIL] Error SQL /api/ventas/stats:', err);
        res.status(500).json({ error: String(err) });
    }
});



/**
 * GET /api/dashboard
 * Devuelve solo resúmenes agregados — sin filas individuales.
 * Ahora acepta todos los mismos filtros que /api/ventas.
 */
app.get('/api/dashboard', async (req, res) => {
    try {
        const q = req.query as Record<string, string | string[] | undefined>;
        if (!q.desde || !q.hasta) {
            return res.status(400).json({ error: 'Se requieren los parámetros desde y hasta' });
        }
        const mkParams = (): VentasQueryFilterParams => ventasFilterPayloadFromQuery(q);
        const sucLog = parseVentasQueryArrays(q).sucursales;

        const incluirKpisAnt = q.incluirPeriodoAnterior === '1';
        const desdeStr = String(q.desde);
        const hastaStr = String(q.hasta);
        const utcNoon = (iso: string) => {
            const [y, m, d] = iso.split('-').map((n) => parseInt(n, 10));
            return Date.UTC(y, m - 1, d, 12, 0, 0);
        };
        const addDaysISO = (iso: string, deltaDays: number): string => {
            const [y, m, d] = iso.split('-').map((n) => parseInt(n, 10));
            const dt = new Date(Date.UTC(y, m - 1, d, 12, 0, 0));
            dt.setUTCDate(dt.getUTCDate() + deltaDays);
            return dt.toISOString().slice(0, 10);
        };
        const N = Math.floor((utcNoon(hastaStr) - utcNoon(desdeStr)) / 86400000) + 1;
        const qPrev: Record<string, string | string[] | undefined> = {
            ...q,
            desde: addDaysISO(desdeStr, -N),
            hasta: addDaysISO(hastaStr, -N),
        };
        const mkParamsPrev = (): VentasQueryFilterParams => ventasFilterPayloadFromQuery(qPrev);

        console.log(`[RETAIL] /api/dashboard: ${q.desde} → ${q.hasta}${q.medioPago ? ' mp=' + q.medioPago : ''}${sucLog.length ? ' suc=' + sucLog.join(',') : ''}${incluirKpisAnt ? ` [kpisAnt N=${N} → ${qPrev.desde}..${qPrev.hasta}]` : ''}`);
        const pool = await ensureConnection();

        const kpiQuery = (paramsFn: () => VentasQueryFilterParams) => {
            const r = pool.request();
            const w = buildWhere(r, paramsFn());
            return r.query(`
                    SELECT
                        SUM(V.[Total cIVA]) AS totalFacturado,
                        COUNT(DISTINCT V.[Nro. Comprobante]) AS voucherCount,
                        SUM(
                            CASE
                                WHEN UPPER(LTRIM(RTRIM(ISNULL(V.[Tipo de comprobante], N'')))) LIKE N'NC%'
                                    THEN 0
                                WHEN [PR.ÚLT.CPA C/IVA] IS NULL OR [PR.ÚLT.CPA C/IVA] <= 0
                                    THEN 0
                                WHEN V.[Precio Neto] IS NULL
                                    THEN 0
                                ELSE V.[Precio Neto] - ([PR.ÚLT.CPA C/IVA] * V.[Cantidad])
                            END
                        ) AS margenTotal
                    FROM Dashboard_Ventas_Local V
                    LEFT JOIN CTA_ARTICULO ON V.[Cód. Artículo] COLLATE DATABASE_DEFAULT = CTA_ARTICULO.COD_CTA_ARTICULO COLLATE DATABASE_DEFAULT
                    ${w}`);
        };

        const parallel: Promise<any>[] = [
            kpiQuery(mkParams),
            (() => {
                const r = pool.request();
                const w = buildWhere(r, mkParams());
                return r.query(`SELECT [Nro. Sucursal] AS nro_sucursal, SUM([Total cIVA]) AS monto
                    FROM Dashboard_Ventas_Local ${w}
                    GROUP BY [Nro. Sucursal]
                    ORDER BY monto DESC`);
            })(),
            (() => {
                const r = pool.request();
                const w = buildWhere(r, mkParams());
                return r.query(`SELECT [Nro. Sucursal] AS nro_sucursal, [Medio de Pago] AS medio_pago, SUM([Total cIVA]) AS monto
                    FROM Dashboard_Ventas_Local ${w}
                    GROUP BY [Nro. Sucursal], [Medio de Pago]
                    ORDER BY [Nro. Sucursal], monto DESC`);
            })(),
        ];
        if (incluirKpisAnt) {
            parallel.push(kpiQuery(mkParamsPrev));
        }

        const results = await Promise.all(parallel);
        const kpisResult = results[0];
        const sucursalResult = results[1];
        const cobrosResult = results[2];
        const kpisAntResult = incluirKpisAnt ? results[3] : null;

        const kpi = kpisResult.recordset[0] ?? {};

        const stacked_data = sucursalResult.recordset.map((s: any) => ({
            nro_sucursal: String(s.nro_sucursal ?? ''),
            categoria_negocio: 'Venta',
            medio_pago: q.medioPago ?? 'Todos',
            monto: Number(s.monto ?? 0),
        }));

        const cobros_por_medio_sucursal = cobrosResult.recordset.map((r: any) => ({
            nro_sucursal: String(r.nro_sucursal ?? ''),
            medio_pago: String(r.medio_pago ?? ''),
            monto: Number(r.monto ?? 0),
        }));

        const totalFacturado = Number(kpi.totalFacturado ?? 0);
        const margenTotal = Number(kpi.margenTotal ?? 0);
        const rentabilidad = totalFacturado !== 0 ? (margenTotal / totalFacturado) * 100 : 0;

        const payload: Record<string, unknown> = {
            kpis: {
                totalFacturado,
                margenTotal,
                rentabilidad,
                voucherCount: Number(kpi.voucherCount ?? 0),
            },
            stacked_data,
            cobros_por_medio_sucursal,
            top_articles: [],
            rubro_points: [],
        };
        if (incluirKpisAnt && kpisAntResult) {
            const ka = kpisAntResult.recordset[0] ?? {};
            const tfAnt = Number(ka.totalFacturado ?? 0);
            const mgAnt = Number(ka.margenTotal ?? 0);
            const rentAnt = tfAnt !== 0 ? (mgAnt / tfAnt) * 100 : 0;
            payload.kpisAnt = {
                totalFacturado: tfAnt,
                margenTotal: mgAnt,
                rentabilidad: rentAnt,
                voucherCount: Number(ka.voucherCount ?? 0),
            };
        }
        console.log(`[RETAIL] /api/dashboard: fact=$${totalFacturado.toFixed(0)} margen=$${margenTotal.toFixed(0)} rent=${rentabilidad.toFixed(1)}% suc=${sucursalResult.recordset.length}`);
        res.json(payload);
    } catch (err) {
        console.error('[RETAIL] Error SQL /api/dashboard:', err);
        res.status(500).json({ error: String(err) });
    }
});

/**
 * GET /api/ventas/options
 * Devuelve los valores DISTINCT de medioPago, familia y categoria para un período.
 * Mucho más eficiente que descargar filas y extraer en JS.
 * Query params: desde, hasta
 */
app.get('/api/ventas/options', async (req, res) => {
    try {
        const q = req.query as Record<string, string | undefined>;
        const pool = await ensureConnection();

        const makeRequest = () => {
            const r = pool.request();
            if (q.desde) r.input('desde', sql.Date, q.desde);
            if (q.hasta) r.input('hasta', sql.Date, q.hasta);
            const where = q.desde && q.hasta
                ? 'WHERE Fecha BETWEEN @desde AND @hasta'
                : q.desde ? 'WHERE Fecha >= @desde'
                    : q.hasta ? 'WHERE Fecha <= @hasta' : '';
            return { r, where };
        };

        const [mpResult, famResult, catResult, sucResult, tipoResult, generoResult, clienteResult] = await Promise.all([
            (() => { const { r, where } = makeRequest(); return r.query(`SELECT DISTINCT [Medio de Pago] AS val FROM Dashboard_Ventas_Local ${where} ORDER BY val`); })(),
            (() => { const { r, where } = makeRequest(); return r.query(`SELECT DISTINCT [Familia] AS val FROM Dashboard_Ventas_Local ${where} ORDER BY val`); })(),
            (() => { const { r, where } = makeRequest(); return r.query(`SELECT DISTINCT [Categoria] AS val FROM Dashboard_Ventas_Local ${where} ORDER BY val`); })(),
            (() => { const { r, where } = makeRequest(); return r.query(`SELECT DISTINCT [Nro. Sucursal] AS val FROM Dashboard_Ventas_Local ${where} ORDER BY val`); })(),
            pool.request().query(`SELECT DISTINCT [TIPO (Adic.)] AS val FROM Dashboard_Ventas_Local WHERE [TIPO (Adic.)] <> '' ORDER BY [TIPO (Adic.)]`),
            pool.request().query(`SELECT DISTINCT [GENERO (Adic.)] AS val FROM Dashboard_Ventas_Local WHERE [GENERO (Adic.)] <> '' ORDER BY [GENERO (Adic.)]`),
            pool.request().query(`SELECT DISTINCT [Cód. Cliente] AS val FROM Dashboard_Ventas_Local WHERE [Cód. Cliente] IS NOT NULL AND [Cód. Cliente] <> '' ORDER BY [Cód. Cliente]`),
        ]);

        const clean = (rs: any[]) => rs.map(r => r.val).filter((v: unknown) => v != null && String(v).trim() !== '').map((v: unknown) => String(v)).sort();
        console.log(`[RETAIL] /api/ventas/options: mp=${mpResult.recordset.length} fam=${famResult.recordset.length}`);
        res.json({
            mediosPago: clean(mpResult.recordset),
            familias: clean(famResult.recordset),
            categorias: clean(catResult.recordset),
            sucursales: clean(sucResult.recordset),
            tipos: clean(tipoResult.recordset),
            generos: clean(generoResult.recordset),
            clientes: clean(clienteResult.recordset),
        });
    } catch (err) {
        console.error('[RETAIL] Error SQL /api/ventas/options:', err);
        res.status(500).json({ error: String(err) });
    }
});



/** Endpoint de introspección — devuelve nombres de columna reales de la vista */
app.get('/api/schema', async (req, res) => {
    try {
        const pool = await ensureConnection();
        const result = await pool.request().query(`
            SELECT COLUMN_NAME, DATA_TYPE
            FROM INFORMATION_SCHEMA.COLUMNS
            WHERE TABLE_NAME = 'Dashboard_Ventas_Local'
            ORDER BY ORDINAL_POSITION
        `);
        res.json(result.recordset);
    } catch (err) {
        res.status(500).json({ error: String(err) });
    }
});

/**
 * GET /api/ai/settings
 */
app.get('/api/ai/settings', (_req, res) => {
    try {
        res.json(readAISettings());
    } catch (err: any) {
        res.status(500).json({ error: String(err?.message ?? err) });
    }
});

/**
 * PUT /api/ai/settings — merge parcial y persiste
 */
app.put('/api/ai/settings', (req, res) => {
    try {
        const body = req.body as Partial<AISettingsFile>;
        const next = mergeAndPersist(body);
        res.json(next);
    } catch (err: any) {
        res.status(500).json({ error: String(err?.message ?? err) });
    }
});

/**
 * GET /api/ai/keys-status — no expone valores
 */
app.get('/api/ai/keys-status', (_req, res) => {
    res.json({
        gemini: Boolean(process.env.GEMINI_API_KEY && String(process.env.GEMINI_API_KEY).trim()),
        anthropic: Boolean(process.env.ANTHROPIC_API_KEY && String(process.env.ANTHROPIC_API_KEY).trim()),
        openai: Boolean(process.env.OPENAI_API_KEY && String(process.env.OPENAI_API_KEY).trim()),
    });
});

/**
 * POST /api/ai/analyze
 * Body: { screen, payload, provider? }
 */
app.post('/api/ai/analyze', async (req, res) => {
    try {
        const body = req.body as {
            screen: 'dashboard' | 'detail' | 'stock';
            payload: object;
            provider?: 'gemini' | 'anthropic' | 'openai';
        };
        if (!body.screen || !body.payload) {
            return res.status(400).json({ error: 'Se requiere screen y payload' });
        }
        const settings = readAISettings();
        const providerName = body.provider ?? settings.provider;
        const provider = getAIProvider(providerName);
        const systemPrompt = buildSystemPrompt(body.screen, settings);
        const userContent = JSON.stringify(body.payload, null, 2);
        console.log(`[RETAIL] Análisis IA (${provider.name}) screen=${body.screen}`);
        const raw = await provider.analyze(systemPrompt, userContent);
        const parsed = parseAIJson(raw);
        res.json({
            ...parsed,
            provider: provider.name,
            analyzedAt: new Date().toISOString(),
        });
    } catch (err: any) {
        console.error('[RETAIL] Error API AI:', err?.message ?? err);
        res.status(500).json({
            error: err?.message || 'Error interno al procesar el análisis',
        });
    }
});

const PORT = 3002;
app.listen(PORT, '0.0.0.0', async () => {
    console.log(`\n\x1b[32m%s\x1b[0m`, `[RETAIL] Servidor API: http://localhost:${PORT}`);
    console.log(`[RETAIL] Timeouts extendidos para entorno local (120s).`);
    console.log(`[RETAIL] Intentando conectar a SQL Local (localhost\\AXSQLSERVER:1433)....`);

    try {
        await ensureConnection();
        console.log(`\x1b[32m%s\x1b[0m`, `[RETAIL] Conexión SQL Exitosa. Listo para servir datos reales.`);
    } catch (err: any) {
        console.error(`\x1b[31m%s\x1b[0m`, `[RETAIL] Falló la conexión inicial a SQL.`);
        if (err.code === 'ELOGIN') {
            console.error(`[RETAIL] Diagnóstico: Error de Credenciales (Axoft/Axoft).`);
        } else if (err.code === 'ETIMEOUT' || err.code === 'ESOCKET') {
            console.error(`[RETAIL] Diagnóstico: Problemas de Red/Protocolo. Verifica que el puerto 1433 y TCP/IP estén habilitados.`);
        }
    }

    console.log(`\x1b[33m%s\x1b[0m`, `[RETAIL] Iniciando túnel Antigravity (Capturando salida)...`);

    // Usamos npm.cmd y shell: false para que NO abra ventanas de PowerShell externas
    const tunnel = spawn('npm.cmd', ['run', 'tunnel'], {
        shell: true,
        stdio: 'pipe'
    });

    tunnel.stdout.on('data', (data) => {
        const output = data.toString();
        // Imprimimos la salida del túnel en la misma terminal de Cursor
        process.stdout.write(output);

        const urlMatch = output.match(/https:\/\/[a-zA-Z0-9.-]+\.antigravity\.me/);
        if (urlMatch) {
            console.log(`\n\x1b[36m%s\x1b[0m`, `***************************************************`);
            console.log(`\x1b[36m%s\x1b[0m`, `[RETAIL] URL PÚBLICA ACTIVA: ${urlMatch[0]}`);
            console.log(`\x1b[36m%s\x1b[0m`, `***************************************************\n`);
        }
    });

    tunnel.stderr.on('data', (data) => {
        process.stderr.write(data.toString());
    });

    tunnel.on('error', (err) => {
        console.error(`[RETAIL] Fallo al iniciar el túnel: ${err.message}`);
    });
});