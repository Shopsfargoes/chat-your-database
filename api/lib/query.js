import pg from "pg";
import mysql from "mysql2/promise";

const { Client: PgClient } = pg;

const FORBIDDEN_KEYWORDS =
  /\b(insert|update|delete|drop|alter|truncate|create|replace|grant|revoke|copy|attach|detach|call|exec|execute|set|vacuum|analyze|lock)\b/i;

export function cleanGeneratedSql(rawText) {
  let sql = String(rawText || "")
    .replace(/```sql\s*/gi, "")
    .replace(/```\s*/g, "")
    .replace(/--.*$/gm, "")
    .replace(/\/\*[\s\S]*?\*\//g, "")
    .trim();

  // Remove a single trailing semicolon, then reject any remaining semicolons
  sql = sql.replace(/;+$/, "").trim();
  if (!sql || sql.includes(";")) {
    throw new Error("Generated SQL must be a single statement without stacked queries.");
  }

  const firstKeyword = sql.split(/\s+/)[0]?.toLowerCase();
  if (firstKeyword !== "select" && firstKeyword !== "with") {
    throw new Error("Only read-only SELECT or CTE (WITH) queries are allowed.");
  }

  if (FORBIDDEN_KEYWORDS.test(sql)) {
    throw new Error("SQL contains disallowed write or administrative keywords.");
  }

  return sql;
}

function wrapWithLimit(sql, dbType, maxRows = 100) {
  const safeLimit = Math.max(1, Math.min(Number(maxRows) || 100, 500));
  if (dbType === "mysql") {
    return `SELECT * FROM (${sql}) AS _subq LIMIT ${safeLimit}`;
  }
  return `SELECT * FROM (${sql}) AS _subq LIMIT ${safeLimit}`;
}

export async function executeReadOnlyQuery(dbType, secrets, sql, maxRows = 100) {
  const safeSql = cleanGeneratedSql(sql);
  const limitedSql = wrapWithLimit(safeSql, dbType, maxRows);

  if (dbType === "postgres") {
    const client = new PgClient({
      host: secrets.host,
      port: Number(secrets.port) || 5432,
      database: secrets.database,
      user: secrets.username,
      password: secrets.password,
      ssl: secrets.ssl ? { rejectUnauthorized: false } : false,
      connectionTimeoutMillis: 8000,
      query_timeout: 10000,
    });

    await client.connect();
    try {
      await client.query("BEGIN TRANSACTION READ ONLY");
      const result = await client.query(limitedSql);
      await client.query("COMMIT");
      return {
        executedSql: safeSql,
        rows: result.rows || [],
        rowCount: result.rows?.length || 0,
      };
    } catch (err) {
      await client.query("ROLLBACK").catch(() => {});
      throw err;
    } finally {
      await client.end().catch(() => {});
    }
  }

  if (dbType === "mysql") {
    const conn = await mysql.createConnection({
      host: secrets.host,
      port: Number(secrets.port) || 3306,
      database: secrets.database,
      user: secrets.username,
      password: secrets.password,
      ssl: secrets.ssl ? { rejectUnauthorized: true } : undefined,
      connectTimeout: 8000,
    });

    try {
      await conn.query("SET SESSION TRANSACTION READ ONLY");
      await conn.beginTransaction();
      const [rows] = await conn.query(limitedSql);
      await conn.commit();
      const rowArray = Array.isArray(rows) ? rows : [];
      return {
        executedSql: safeSql,
        rows: rowArray,
        rowCount: rowArray.length,
      };
    } catch (err) {
      await conn.rollback().catch(() => {});
      throw err;
    } finally {
      await conn.end().catch(() => {});
    }
  }

  throw new Error(`Unsupported database type: ${dbType}`);
}