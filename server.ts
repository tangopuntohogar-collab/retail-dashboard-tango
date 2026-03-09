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
    server: 'INFOSYS01',
    database: 'PUNTO_HOGAR_1',
    requestTimeout: 60000,   // 60s — queries sobre 108k filas pueden tardar
    connectionTimeout: 30000,   // 30s — primera conexión al servidor remoto
    options: {
        encrypt: false,
        trustServerCertificate: true,
        instanceName: 'AXSQLSERVER'
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
        proveedor?: string;
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
    if (params.proveedor) {
        request.input('proveedor', sql.NVarChar, params.proveedor);
        clauses.push('[PROVEEDOR (Adic.)] = @proveedor');
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
    [Fecha], [Nro. Sucursal], [Tipo de comprobante], [Nro. Comprobante],
    [Cód. vendedor], [Cód. Artículo], [Descripción],
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

        // ── Stats globales (COUNT + SUM) — una sola query, independiente de la paginación ──
        const statsReq = pool.request();
        const whereStats = buildWhere(statsReq, {
            desde: q.desde, hasta: q.hasta,
            medioPago: q.medioPago, familia: q.familia, categoria: q.categoria,
            proveedor: q.proveedor,
            sucursales: sucArray,
        });
        const statsResult = await statsReq.query(`
            SELECT COUNT(*) AS total, SUM([Total cIVA]) AS totalImporteGlobal
            FROM Dashboard_Ventas_Local ${whereStats}
        `);
        const total = Number(statsResult.recordset[0]?.total ?? 0);
        const totalImporteGlobal = Number(statsResult.recordset[0]?.totalImporteGlobal ?? 0);

        // ── Request para datos paginados ───────────────────────────────────
        const dataReq = pool.request();
        const whereData = buildWhere(dataReq, {
            desde: q.desde, hasta: q.hasta,
            medioPago: q.medioPago, familia: q.familia, categoria: q.categoria,
            proveedor: q.proveedor,
            sucursales: sucArray,
        });
        dataReq.input('offset', sql.Int, offset);
        dataReq.input('limit', sql.Int, limit);

        const dataResult = await dataReq.query(`
            SELECT ${VENTAS_COLUMNS}
            FROM Dashboard_Ventas_Local
            ${whereData}
            ORDER BY Fecha DESC
            OFFSET @offset ROWS FETCH NEXT @limit ROWS ONLY
        `);

        console.log(`[RETAIL] /api/ventas page=${page} limit=${limit} → ${dataResult.recordset.length}/${total} ($${totalImporteGlobal.toFixed(0)})`);
        res.json({
            data: dataResult.recordset,
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
 * Igual que /api/ventas pero SIN paginación — devuelve TODOS los registros filtrados.
 * Máximo 50.000 filas para proteger la memoria del servidor.
 */
app.get('/api/ventas/exportar', async (req, res) => {
    try {
        const q = req.query as Record<string, string | string[] | undefined>;
        const sucArray = Array.isArray(q.sucursal)
            ? (q.sucursal as string[])
            : q.sucursal ? [q.sucursal as string] : [];

        const pool = await sql.connect(config);
        const dataReq = pool.request();
        const where = buildWhere(dataReq, {
            desde: q.desde as string, hasta: q.hasta as string,
            medioPago: q.medioPago as string,
            familia: q.familia as string,
            categoria: q.categoria as string,
            proveedor: q.proveedor as string,
            sucursales: sucArray,
        });

        const result = await dataReq.query(`
            SELECT TOP 50000 ${VENTAS_COLUMNS}
            FROM Dashboard_Ventas_Local
            ${where}
            ORDER BY Fecha DESC
        `);

        console.log(`[RETAIL] /api/ventas/exportar → ${result.recordset.length} filas (sin paginación)`);
        res.json({ data: result.recordset, total: result.recordset.length });
    } catch (err) {
        console.error('[RETAIL] Error SQL /api/ventas/exportar:', err);
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
            proveedor: q.proveedor as string,
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
            proveedor: q.proveedor as string,
            sucursales: sucArray,
        });

        console.log(`[RETAIL] /api/dashboard: ${q.desde} → ${q.hasta}${q.medioPago ? ' mp=' + q.medioPago : ''}${sucArray.length ? ' suc=' + sucArray.join(',') : ''}`);
        const pool = await sql.connect(config);

        const [kpisResult, sucursalResult, articulosResult, rubrosResult] = await Promise.all([

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

            // 3. Top 10 Artículos
            (() => {
                const r = pool.request();
                const w = buildWhere(r, mkParams());
                return r.query(`SELECT TOP 10 [Cód. Artículo] AS cod_articu,
                       MAX([Descripción]) AS descripcio,
                       SUM([Total cIVA])  AS total, SUM([Cantidad]) AS cant
                    FROM Dashboard_Ventas_Local ${w}
                    GROUP BY [Cód. Artículo]
                    ORDER BY total DESC`);
            })(),

            // 4. Dispersión por Rubro
            (() => {
                const r = pool.request();
                const w = buildWhere(r, mkParams());
                return r.query(`SELECT ISNULL([Familia], 'Otros') AS rubro,
                       SUM([Cantidad]) AS total_cantidad, 0 AS avg_margen
                    FROM Dashboard_Ventas_Local ${w}
                    GROUP BY [Familia]
                    ORDER BY total_cantidad DESC`);
            })(),
        ]);

        const kpi = kpisResult.recordset[0] ?? {};
        const stacked_data = sucursalResult.recordset.map((s: any) => ({
            nro_sucursal: String(s.nro_sucursal ?? ''),
            categoria_negocio: 'Venta',
            medio_pago: q.medioPago ?? 'Todos',
            monto: Number(s.monto ?? 0),
        }));
        const top_articles = articulosResult.recordset.map((r: any) => ({
            cod_articu: r.cod_articu ?? '', descripcio: r.descripcio ?? '',
            total: Number(r.total ?? 0), cant: Number(r.cant ?? 0), margen: 0,
        }));
        const rubro_points = rubrosResult.recordset.map((r: any) => ({
            rubro: r.rubro ?? 'Otros', total_cantidad: Number(r.total_cantidad ?? 0), avg_margen: 0,
        }));

        const payload = {
            kpis: {
                totalFacturado: Number(kpi.totalFacturado ?? 0),
                margenTotal: 0, rentabilidad: 0,
                voucherCount: Number(kpi.voucherCount ?? 0),
            },
            stacked_data, top_articles, rubro_points,
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
app.listen(PORT, () => {
    console.log(`\n\x1b[32m%s\x1b[0m`, `[RETAIL] Servidor local escuchando en http://localhost:${PORT}`);
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