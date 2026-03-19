import express from 'express';
import sql from 'mssql';
import cors from 'cors';
import { spawn } from 'child_process';

const app = express();
app.use(cors());
app.use(express.json());

const config: any = {
    user: 'Axoft',
    password: 'Axoft',
    server: 'SERVIDORT',
    database: 'PUNTO_HOGAR_1',
    requestTimeout: 60000,   // 60s — queries sobre 108k filas pueden tardar
    connectionTimeout: 30000,   // 30s — primera conexión al servidor remoto
    options: {
        encrypt: false,
        trustServerCertificate: true,
        instanceName: 'AXSQLEXPRESS'
    }
};

// ─── Helper: construye WHERE dinámico usando parámetros SQL nombrados ────────
function buildWhere(
    request: any,
    params: {
        desde?: string;
        hasta?: string;
        medioPago?: string;
        familia?: string;
        categoria?: string;
        sucursales?: string[];   // ← NUEVO: filtra por una o varias sucursales
        proveedores?: string[];
    }
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

    return clauses.length ? `WHERE ${clauses.join(' AND ')}` : '';
}


// ─── Columnas para el detalle ─────────────────────────────────────────────────
const VENTAS_COLUMNS = `
    FORMAT(Dashboard_Ventas_Local.[Fecha], 'yyyy-MM-dd') AS Fecha,
    [Nro. Sucursal], [Tipo de comprobante], [Nro. Comprobante],
    [Cód. vendedor], [Cód. Artículo], [Descripción], CTA_ARTICULO.DESC_ADICIONAL_ARTICULO AS DescripcionAdicional,
    [Medio de Pago],[Precio Neto], [Precio Unitario], [Total cIVA],
    [Familia], [Categoria], [Cantidad], [PROVEEDOR (Adic.)], [PR.ÚLT.CPA C/IVA] AS CostoUnitario`;
/* ── PENDIENTE: agregar [Precio Neto] cuando el ALTER VIEW sea ejecutado en SQL Server ── */





/**
 * GET /api/ventas
 * Query params: desde, hasta, medioPago, familia, categoria, page (0-based), limit (default 500)
 * Devuelve { data: [], total: N } con paginación server-side.
 */
app.get('/api/ventas', async (req, res) => {
    try {
        const q = req.query as Record<string, string | undefined>;
        const page = Math.max(0, parseInt(q.page ?? '0', 10));
        const limit = Math.min(2000, Math.max(1, parseInt(q.limit ?? '500', 10)));
        const offset = page * limit;

        const pool = await sql.connect(config);

        // sucursal puede venir como ?sucursal=1002&sucursal=1018 → array
        const sucArray = Array.isArray(q.sucursal)
            ? (q.sucursal as string[])
            : q.sucursal ? [q.sucursal] : [];
            
        // proveedor puede venir como array
        const provArray = Array.isArray(q.proveedor)
            ? (q.proveedor as string[])
            : q.proveedor ? [q.proveedor] : [];

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
            const compWhereActual = [
                'Fecha BETWEEN @desde AND @hasta',
                ...(q.medioPago ? ['[Medio de Pago] = @medioPago'] : []),
                ...(q.familia ? ['[Familia] = @familia'] : []),
                ...(q.categoria ? ['[Categoria] = @categoria'] : []),
                ...(provArray.length > 0 ? (provArray.length === 1 ? ['[PROVEEDOR (Adic.)] = @proveedor0'] : [`[PROVEEDOR (Adic.)] IN (${provArray.map((_, i) => `@proveedor${i}`).join(', ')})`]) : []),
                ...sucClauses,
            ].filter(Boolean).join(' AND ');

            const compWhereAnterior = [
                'Fecha BETWEEN DATEADD(month, -1, @desde) AND DATEADD(month, -1, @hasta)',
                ...(q.medioPago ? ['[Medio de Pago] = @medioPago'] : []),
                ...(q.familia ? ['[Familia] = @familia'] : []),
                ...(q.categoria ? ['[Categoria] = @categoria'] : []),
                ...(provArray.length > 0 ? (provArray.length === 1 ? ['[PROVEEDOR (Adic.)] = @proveedor0'] : [`[PROVEEDOR (Adic.)] IN (${provArray.map((_, i) => `@proveedor${i}`).join(', ')})`]) : []),
                ...sucClauses,
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
            const countRes = await countReq.query(`
                SELECT COUNT(*) AS total, SUM([Total cIVA]) AS totalImporteGlobal
                FROM Dashboard_Ventas_Local
                WHERE ${compWhereActual}
            `);
            total = Number(countRes.recordset[0]?.total ?? 0);
            totalImporteGlobal = Number(countRes.recordset[0]?.totalImporteGlobal ?? 0);
        } else {
            const statsReq = pool.request();
            const whereStats = buildWhere(statsReq, {
                desde: q.desde, hasta: q.hasta,
                medioPago: q.medioPago, familia: q.familia, categoria: q.categoria,
                proveedores: provArray,
                sucursales: sucArray,
            });
            const statsResult = await statsReq.query(`
                SELECT COUNT(*) AS total, SUM([Total cIVA]) AS totalImporteGlobal
                FROM Dashboard_Ventas_Local ${whereStats}
            `);
            total = Number(statsResult.recordset[0]?.total ?? 0);
            totalImporteGlobal = Number(statsResult.recordset[0]?.totalImporteGlobal ?? 0);

            const dataReq = pool.request();
            const whereData = buildWhere(dataReq, {
                desde: q.desde, hasta: q.hasta,
                medioPago: q.medioPago, familia: q.familia, categoria: q.categoria,
                proveedores: provArray,
                sucursales: sucArray,
            });
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
 * GET /api/stock
 * Obtiene saldos de stock por artículo, sucursal y depósito.
 * Incluye campos adicionales de STA11 y costo PPP.
 */
app.get('/api/stock', async (req, res) => {
    console.log('[RETAIL] /api/stock: Buscando saldos de inventario...');
    try {
        const q = req.query as Record<string, string | string[] | undefined>;
        const pool = await sql.connect(config);
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
            
            SELECT
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

/**
 * GET /api/saldos-cajas
 * Saldos de tesorería por sucursal y cuenta — último registro por sucursal/cuenta.
 */
app.get('/api/saldos-cajas', async (req, res) => {
    try {
        const pool = await sql.connect(config);
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
        const pool = await sql.connect(config);
        const request = pool.request();
        const sucArray = Array.isArray(q.sucursal)
            ? (q.sucursal as string[])
            : q.sucursal ? [q.sucursal as string] : [];
        const where = buildWhere(request, {
            desde: q.desde as string, hasta: q.hasta as string,
            medioPago: q.medioPago as string,
            familia: q.familia as string,
            categoria: q.categoria as string,
            proveedores: Array.isArray(q.proveedor) ? q.proveedor : q.proveedor ? [q.proveedor as string] : [],
            sucursales: sucArray,
        });

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
        const sucArray = Array.isArray(q.sucursal)
            ? (q.sucursal as string[])
            : q.sucursal ? [q.sucursal as string] : [];

        const mkParams = () => ({
            desde: q.desde as string, hasta: q.hasta as string,
            medioPago: q.medioPago as string,
            familia: q.familia as string,
            categoria: q.categoria as string,
            proveedores: Array.isArray(q.proveedor) ? q.proveedor : q.proveedor ? [q.proveedor as string] : [],
            sucursales: sucArray,
        });

        console.log(`[RETAIL] /api/dashboard: ${q.desde} → ${q.hasta}${q.medioPago ? ' mp=' + q.medioPago : ''}${sucArray.length ? ' suc=' + sucArray.join(',') : ''}`);
        const pool = await sql.connect(config);

        const [kpisResult, sucursalResult, cobrosResult] = await Promise.all([

            // 1. KPIs globales
            (() => {
                const r = pool.request();
                const w = buildWhere(r, mkParams());
                return r.query(`SELECT SUM([Total cIVA]) AS totalFacturado,
                       COUNT(DISTINCT [Nro. Comprobante]) AS voucherCount
                    FROM Dashboard_Ventas_Local ${w}`);
            })(),

            // 2. Ventas por Sucursal
            (() => {
                const r = pool.request();
                const w = buildWhere(r, mkParams());
                return r.query(`SELECT [Nro. Sucursal] AS nro_sucursal, SUM([Total cIVA]) AS monto
                    FROM Dashboard_Ventas_Local ${w}
                    GROUP BY [Nro. Sucursal]
                    ORDER BY monto DESC`);
            })(),

            // 3. Cobros por Sucursal y Medio de Pago (para Resumen de Cobros)
            (() => {
                const r = pool.request();
                const w = buildWhere(r, mkParams());
                return r.query(`SELECT [Nro. Sucursal] AS nro_sucursal, [Medio de Pago] AS medio_pago, SUM([Total cIVA]) AS monto
                    FROM Dashboard_Ventas_Local ${w}
                    GROUP BY [Nro. Sucursal], [Medio de Pago]
                    ORDER BY [Nro. Sucursal], monto DESC`);
            })(),
        ]);

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

        const payload = {
            kpis: {
                totalFacturado: Number(kpi.totalFacturado ?? 0),
                margenTotal: 0, rentabilidad: 0,
                voucherCount: Number(kpi.voucherCount ?? 0),
            },
            stacked_data,
            cobros_por_medio_sucursal,
            top_articles: [],
            rubro_points: [],
        };
        console.log(`[RETAIL] /api/dashboard: $${payload.kpis.totalFacturado.toFixed(0)}, suc=${sucursalResult.recordset.length}`);
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
        const pool = await sql.connect(config);

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

        const [mpResult, famResult, catResult, sucResult] = await Promise.all([
            (() => { const { r, where } = makeRequest(); return r.query(`SELECT DISTINCT [Medio de Pago] AS val FROM Dashboard_Ventas_Local ${where} ORDER BY val`); })(),
            (() => { const { r, where } = makeRequest(); return r.query(`SELECT DISTINCT [Familia] AS val FROM Dashboard_Ventas_Local ${where} ORDER BY val`); })(),
            (() => { const { r, where } = makeRequest(); return r.query(`SELECT DISTINCT [Categoria] AS val FROM Dashboard_Ventas_Local ${where} ORDER BY val`); })(),
            (() => { const { r, where } = makeRequest(); return r.query(`SELECT DISTINCT [Nro. Sucursal] AS val FROM Dashboard_Ventas_Local ${where} ORDER BY val`); })(),
        ]);

        const clean = (rs: any[]) => rs.map(r => r.val).filter(Boolean).sort();
        console.log(`[RETAIL] /api/ventas/options: mp=${mpResult.recordset.length} fam=${famResult.recordset.length}`);
        res.json({
            mediosPago: clean(mpResult.recordset),
            familias: clean(famResult.recordset),
            categorias: clean(catResult.recordset),
            sucursales: clean(sucResult.recordset),
        });
    } catch (err) {
        console.error('[RETAIL] Error SQL /api/ventas/options:', err);
        res.status(500).json({ error: String(err) });
    }
});



/** Endpoint de introspección — devuelve nombres de columna reales de la vista */
app.get('/api/schema', async (req, res) => {
    try {
        const pool = await sql.connect(config);
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

const PORT = 3002;
app.listen(PORT, '0.0.0.0', () => {
    console.log(`\n\x1b[32m%s\x1b[0m`, `[RETAIL] Servidor en red: http://192.168.1.74:${PORT}`);
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