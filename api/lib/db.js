import pg from "pg";
import mysql from "mysql2/promise";

const { Client: PgClient } = pg;

export async function introspectDatabase(config) {
  const dbType = config.db_type;

  if (dbType === "postgres") {
    const client = new PgClient({
      host: config.host,
      port: Number(config.port) || 5432,
      database: config.database,
      user: config.username,
      password: config.password,
      ssl: config.ssl ? { rejectUnauthorized: false } : false,
      connectionTimeoutMillis: 8000,
    });

    await client.connect();
    try {
      await client.query("SELECT 1");

      const { rows } = await client.query(`
        SELECT
          table_schema,
          table_name,
          column_name,
          data_type,
          is_nullable
        FROM information_schema.columns
        WHERE table_schema = 'public'
        ORDER BY table_name, ordinal_position;
      `);

      return groupColumnsIntoSchema(rows);
    } finally {
      await client.end().catch(() => {});
    }
  }

  if (dbType === "mysql") {
    const conn = await mysql.createConnection({
      host: config.host,
      port: Number(config.port) || 3306,
      database: config.database,
      user: config.username,
      password: config.password,
      ssl: config.ssl ? { rejectUnauthorized: true } : undefined,
      connectTimeout: 8000,
    });

    try {
      await conn.query("SELECT 1");

      const [rows] = await conn.query(
        `
        SELECT
          TABLE_SCHEMA AS table_schema,
          TABLE_NAME AS table_name,
          COLUMN_NAME AS column_name,
          COLUMN_TYPE AS data_type,
          IS_NULLABLE AS is_nullable
        FROM information_schema.columns
        WHERE TABLE_SCHEMA = ?
        ORDER BY TABLE_NAME, ORDINAL_POSITION;
        `,
        [config.database]
      );

      return groupColumnsIntoSchema(rows);
    } finally {
      await conn.end().catch(() => {});
    }
  }

  throw new Error(`Unsupported database type: ${dbType}`);
}

function groupColumnsIntoSchema(rows) {
  const tableMap = new Map();

  for (const row of rows) {
    const tableName = row.table_name;
    if (!tableMap.has(tableName)) {
      tableMap.set(tableName, []);
    }
    const nullability = row.is_nullable === "NO" ? " NOT NULL" : "";
    tableMap.get(tableName).push(`${row.column_name} ${row.data_type}${nullability}`);
  }

  const tables = Array.from(tableMap.entries()).map(([name, cols]) => ({
    name,
    columnCount: cols.length,
    ddl: `CREATE TABLE ${name} (\n  ${cols.join(",\n  ")}\n);`,
  }));

  return {
    tableCount: tables.length,
    tables,
    schemaDdl: tables.map((t) => t.ddl).join("\n\n"),
  };
}