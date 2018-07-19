const pg = require("pg")
const parseUrl = require("url").parse
if (!process.env.DATABASE_URL) {
  throw new Error("Must specify process.env.DATABASE_URL")
}
const dbParams = parseUrl(process.env.DATABASE_URL)
process.env.DEBUG && console.log("🛢  connecting to ", process.env.DATABASE_URL)
const dbAuth = dbParams.auth.split(":")
const dbConfig = {
  database: dbParams.pathname.split("/")[1],
  host: dbParams.hostname,
  password: dbAuth[1],
  port: dbParams.port,
  ssl: Boolean(dbAuth[1]),
  user: dbAuth[0],
}
const pool = new pg.Pool(dbConfig)
pool.on("error", err => console.log("Pool error, idle client", err.message, err.stack))
const client = new pg.Client(dbConfig)
client.on("error", err => console.log("Client error", err.message, err.stack))

// module.exports = {executeSql, connectSql, endSql}
module.exports = executeSql

async function executeSql (...args) {
  process.env.DEBUG && console.log("[SQL] executing", ...args)
  return await pool.query(...args).then(toRows)
  // return await client.query(...args).then(toRows)
}

function toRows (sqlResult) {
  return sqlResult.rows
}

async function connectSql () {
  process.env.DEBUG && console.log("[SQL] connecting")
  "pool already connected"
  // await client.connect()
}

async function endSql () {
  process.env.DEBUG && console.log("[SQL] ending")
  return await pool.end()
  // return await client.end()
}
