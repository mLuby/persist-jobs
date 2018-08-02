let interval = null
const registeredJobs = {}
const config = {}

module.exports = function Jobs ({executeSql, table, onError = console.error}) {
  if (!executeSql || typeof executeSql !== "function") {
    throw new Error("Jobs must specify {executeSql: Function}")
  }
  if (!table || typeof table !== "string") {
    throw new Error("Jobs must specify {table: String}")
  }
  config.executeSql = executeSql
  config.table = table
  config.onError = onError
  return {cancel, clear, list, register, schedule, start, stop}
}

function start ({intervalMs}) {
  interval && stop(interval)
  if (isNaN(intervalMs)) {
    throw new Error("Jobs.start must specify {intervalMs: Number}")
  }
  interval = setInterval(checkAndExecuteJobs, intervalMs)
  /* istanbul ignore next */ process.env.DEBUG && console.log("[Jobs] started")
  checkAndExecuteJobs() // run once immediately since interval waits first
}

function stop () {
  clearInterval(interval)
  /* istanbul ignore next */ process.env.DEBUG && console.log("[Jobs] stopped")
}

function register (jobFunc) {
  if (registeredJobs[jobFunc.name]) {
    throw new Error(`[Jobs] already registered ${jobFunc.name}`)
  }
  registeredJobs[jobFunc.name] = jobFunc
}

async function schedule (due_at, jobFunc, ...argsJson) {
  try {
    if (!registeredJobs[jobFunc.name]) {
      throw new Error(`[Jobs] can't schedule unregistered job ${jobFunc.name}`)
    }
  } catch (error) {
    /* istanbul ignore next */ process.env.DEBUG && console.trace()
    throw error
  }
  /* istanbul ignore next */ process.env.DEBUG && console.log(`[Jobs] scheduling ${jobFunc.name}(${argsJson ? argsJson.map(x => JSON.stringify(x)).join(", ") : ""}) at ${due_at}`)
  return await config.executeSql(`INSERT INTO ${config.table} (due_at, type, args) VALUES ('${due_at}', '${jobFunc.name}', '${JSON.stringify(argsJson).replace("'", "''")}') RETURNING job_id;`).then(r => r[0].job_id)
}

function clear () { // for testing only
  Object.keys(registeredJobs).forEach(key => delete registeredJobs[key])
}

async function cancel (jobId) {
  /* istanbul ignore next */ process.env.DEBUG && console.log(`[Jobs] cancelling ${jobId}`)
  return await config.executeSql(`DELETE FROM ${config.table} WHERE job_id = ${jobId};`)
}

async function list () {
  /* istanbul ignore next */ process.env.DEBUG && console.log("[Jobs] listing all active jobs")
  return await config.executeSql(`SELECT * FROM ${config.table} WHERE run_at IS NULL;`)
}

// HELPERS

async function checkAndExecuteJobs () {
  const jobs = await config.executeSql(`SELECT * FROM ${config.table} WHERE run_at IS NULL AND due_at < NOW();`)
  jobs.forEach(async job => {
    try {
      if (!registeredJobs[job.type]) {
        throw new Error(`[Jobs] no registered job of type ${job.type}`)
      }
      job.run_at = new Date().toISOString()
      await config.executeSql(`UPDATE ${config.table} SET run_at = '${job.run_at}' WHERE job_id = ${job.job_id};`)
      runJob(job)
    } catch (error) { config.onError(error, job) }
  })
}

function runJob (job) {
  /* istanbul ignore next */ process.env.DEBUG && console.log(`[Jobs] ${job.job_id} due_at ${new Date(job.due_at)} run_at ${job.run_at} ${job.type}`)
  const jobFunc = registeredJobs[job.type]
  const jobArgs = JSON.parse(job.args)
  jobArgs && jobArgs.length ? jobFunc(...jobArgs) : jobFunc()
}
