const tape = require("tape")
const executeSql = require('./psql.js')
const JobsPath = "../index.js"
const table = "JobsTest"
const intervalMs = 1000

const xtape = () => {}

tape("setup", async t => {
  t.plan(1)
  await createJobsTable(table)
  t.pass("should set up test db")
})

tape("throws without executeSql function", async t => {
  t.plan(1)
  t.throws(() => require(JobsPath)({table}), /Jobs must specify {executeSql: Function}/)
})

tape("throws without table String", async t => {
  t.plan(1)
  t.throws(() => require(JobsPath)({executeSql}), /Jobs must specify {table: String}/)
})

tape("throws without interval Number", async t => {
  t.plan(1)
  const Jobs = require(JobsPath)({executeSql, table})
  t.throws(() => Jobs.start({}), /Jobs.start must specify {intervalMs: Number}/)
})

tape("can run jobs with no arguments", async t => {
  t.plan(1)

  const Jobs = require(JobsPath)({executeSql, table})
  Jobs.clear()
  Jobs.register(pass)
  await Jobs.schedule(now(), pass)
  Jobs.start({intervalMs})

  function pass () { t.pass("should run job"); Jobs.stop(); }
})

tape("can run jobs with multiple arguments", async t => {
  t.plan(1)

  const Jobs = require(JobsPath)({executeSql, table})
  Jobs.clear()
  Jobs.register(pass)
  await Jobs.schedule(now(), pass, "a", {b: 3})
  Jobs.start({intervalMs})

  function pass (arg1, arg2) { t.deepEqual([arg1, arg2], ["a", {b: 3}], "should run job w arguments"); Jobs.stop() }
})

tape("scheduling job returns job_id", async t => {
  t.plan(1)
  const Jobs = require(JobsPath)({executeSql, table})
  Jobs.clear()
  Jobs.register(now)
  const job_id = await Jobs.schedule("2018-07-18", now, "scheduling job returns job_id")
  const job = await executeSql(`SELECT * FROM ${table} WHERE job_id = ${job_id};`).then(r => r[0])
  delete job.due_at // TODO because local time zone may be different on different machines.
  delete job.job_id // TODO because sequence increases
  t.deepEqual(job,  {type: 'now', args: '["scheduling job returns job_id"]', run_at: null }, "should have a scheduled job for returned job_id")
  await executeSql(`UPDATE ${table} SET run_at = '2018-07-18' WHERE job_id = ${job_id};`) // because it's never been run and will interfere w other tests.
})

tape("can configure table name", async t => {
  t.plan(3)
  const newTable = "JobsTestAlternate"
  await createJobsTable(newTable)

  const Jobs = require(JobsPath)({executeSql, table: newTable})
  Jobs.clear()
  Jobs.register(now)
  t.equal(await executeSql(`SELECT COUNT(*) FROM ${newTable};`).then(r => Number(r[0].count)), 0, "should be no jobs in new table")
  const count = await executeSql(`SELECT COUNT(*) FROM ${table};`).then(r => Number(r[0].count))
  await Jobs.schedule(now(), now, "can't register jobs with the same name")
  t.equal(await executeSql(`SELECT COUNT(*) FROM ${newTable};`).then(r => Number(r[0].count)), 1, "should be one job in new table")
  t.equal(await executeSql(`SELECT COUNT(*) FROM ${table};`).then(r => Number(r[0].count)), count, "should not affect existing table")

  await dropJobsTable(newTable)
})

tape("can configure sql executor function (enables multiple SQL flavors)", async t => {
  t.plan(1)
  const Jobs = require(JobsPath)({executeSql: mockSql, table})
  Jobs.register(mockSql)
  await Jobs.schedule('2018-07-18', mockSql)
  function mockSql (sqlString) {
    t.equal(sqlString, `INSERT INTO ${table} (due_at, type, args) VALUES ('2018-07-18', 'mockSql', '[]') RETURNING job_id;`, "should use new executeSql")
    return Promise.resolve([{}])
  }
})

tape("can't register jobs with the same name", async t => {
  t.plan(1)
  const Jobs = require(JobsPath)({executeSql, table})
  Jobs.clear()
  Jobs.register(now)
  t.throws(() => Jobs.register(now), /already registered now/)
})

tape("can't schedule jobs that aren't registered", async t => {
  t.plan(1)
  const Jobs = require(JobsPath)({executeSql, table})
  Jobs.clear()
  try {
    await Jobs.schedule(now(), now, "can't schedule jobs that aren't registered")
  } catch (e) {
    t.equals(e.message, "[Jobs] can't schedule unregistered job now", "should throw")
  }
})

tape("marks job complete when run", async t => {
  t.plan(2)

  const Jobs = require(JobsPath)({executeSql, table})
  Jobs.clear()
  Jobs.register(func)
  const job_id = await Jobs.schedule(now(), func, "marks job complete when run")
  t.equal(await executeSql(`SELECT run_at FROM ${table} WHERE job_id = ${job_id};`).then(r => r[0].run_at), null, "should have run_at as null before being run")
  Jobs.start({intervalMs})

  async function func () {
    Jobs.stop()
    t.ok(await executeSql(`SELECT run_at FROM ${table} WHERE job_id = ${job_id};`).then(r => r[0].run_at), "should have run_at as not null after being run")
  }
})

tape("marks job complete even if the job fails", async t => {
  t.plan(2)

  const Jobs = require(JobsPath)({executeSql, table, onError: after})
  Jobs.clear()
  Jobs.register(willFail)
  const job_id = await Jobs.schedule(now(), willFail)
  t.equal(await executeSql(`SELECT run_at FROM ${table} WHERE job_id = ${job_id};`).then(r => r[0].run_at), null, "should have run_at as null before being run")
  Jobs.start({intervalMs})

  function willFail () {
    throw new Error("Failed")
  }

  async function after () {
    Jobs.stop()
    t.ok(await executeSql(`SELECT run_at FROM ${table} WHERE job_id = ${job_id};`).then(r => r[0].run_at), "should have run_at as not null after being run")
  }
})

tape("doesn't mark job complete if job not registered", async t => {
  t.plan(3)

  const Jobs = require(JobsPath)({executeSql, table, onError})
  Jobs.clear()
  Jobs.register(now)
  const job_id = await Jobs.schedule(now(), now, "doesn't mark job complete if job not registered")
  t.equal(await executeSql(`SELECT run_at FROM ${table} WHERE job_id = ${job_id};`).then(r => r[0].run_at), null, "should have run_at as null before being run")
  Jobs.clear()

  Jobs.start({intervalMs})

  async function onError (error, job) {
    Jobs.stop()
    t.equal(job.job_id, job_id, "should have errored on the right job")
    t.equal(await executeSql(`SELECT run_at FROM ${table} WHERE job_id = ${job_id};`).then(r => r[0].run_at), null, "should have run_at as not null after failing to run")
  }
})

tape("can list all active jobs", async t => {
  t.plan(1)

  const Jobs = require(JobsPath)({executeSql, table})
  await executeSql(`DELETE FROM ${table};`)
  Jobs.clear()
  Jobs.register(now)
  const job_id1 = await Jobs.schedule(now(), now, 1)
  const job_id2 = await Jobs.schedule(now(), now, 2)

  t.deepEqual(
    await Jobs.list().then(rs => rs.map(r => Object.assign(r, {due_at: true}))),
    [{job_id: job_id1, due_at: true, type: "now", args: "[1]", run_at: null}, {job_id: job_id2, due_at: true, type: "now", args: "[2]", run_at: null}], // eslint-disable-line sort-keys
    "should list active jobs",
  )
})

tape("can cancel a job (deleting it)", async t => {
  t.plan(2)

  const Jobs = require(JobsPath)({executeSql, table})
  await executeSql(`DELETE FROM ${table};`)
  Jobs.clear()
  Jobs.register(now)
  const job_id1 = await Jobs.schedule(now(), now, 1)
  const job_id2 = await Jobs.schedule(now(), now, 2)

  t.deepEqual(await Jobs.list().then(rs => rs.map(r => r.job_id)), [job_id1, job_id2], "both jobs exist")
  await Jobs.cancel(job_id1)
  t.deepEqual(await Jobs.list().then(rs => rs.map(r => r.job_id)), [job_id2], "cancelled job is deleted")
})

xtape("can configure job check interval", async t => {})

xtape("can stop and restart Jobs (clears interval)", async t => {})

xtape("escapes SQL properly (eg quotes and -- don't mess up arguments).", async t => {})

xtape("doesn't run a job multiple times even if interval is short", async t => {})

// TODO func.name could get confusing. see t.pass. maybe provide string option?

tape("teardown", async t => {
  t.plan(1)
  await dropJobsTable(table)
  t.pass("should tear down test db")
})

// HELPERS

function now () {
  return new Date().toISOString()
}

async function createJobsTable(tableName) {
  await executeSql(`DROP TABLE IF EXISTS ${tableName}; CREATE TABLE ${tableName} (job_id SERIAL PRIMARY KEY, due_at TIMESTAMP WITH TIME ZONE NOT NULL, type TEXT NOT NULL, args TEXT, run_at TIMESTAMP);`)
}

async function dropJobsTable(tableName) {
  await executeSql(`DROP TABLE ${tableName};`)
}
