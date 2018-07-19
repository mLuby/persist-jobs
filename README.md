[![Build Status](https://travis-ci.org/mLuby/jobs.svg?branch=master)](https://travis-ci.org/mLuby/jobs)[![Coverage Status](https://coveralls.io/repos/github/mLuby/jobs/badge.svg?branch=master)](https://coveralls.io/github/mLuby/jobs?branch=master)
# Jobs
Persistent Job Scheduler for Node (SQL)

# Goal
- simple to use and configure.
- persistent/restart/crash-tolerant: after scheduling, schedule process can die and whenever it's restarted it'll run whatever jobs are necessary.
- not a footgun: throw helpful errors if dev tries to do something like schedule jobs that aren't registered.

# How to use
```js
const Jobs = require("jobs")({sql: executeSqlPromise})
Jobs.start({intervalMs: 1000})

function someFunc (a, b) { console.log("someFunc!", a, b) }
Jobs.register(someFunc) // lets scheduler know what to call when it sees a job called 'someFunc'

const someDate = new Date().toISOString() // date comes out as "2018-07-18T16:22:00-05"
Jobs.schedule(someDate, someFunc, {subject: "foo"}, 2)

// at 2018-07-18 16:22:00-05, console should output someFunc! {subject: "foo"} 2

Jobs.stop()
```

# Setup
1. create the table in your SQL database. (Note the table name can be [configured](#Config Options).)
```sql
CREATE TABLE Jobs (
  job_id SERIAL PRIMARY KEY,
  due_at TIMESTAMP WITH TIME ZONE NOT NULL,
  type TEXT NOT NULL,
  args TEXT, -- Stringified JSON
  run_at TIMESTAMP
);
```
2. Install and use as per the example above.
```sh
npm install --save jobs
```
3. Require and instantiate the Jobs singleton
```js
const Jobs = require("jobs")({sql: executeSqlPromise}) // executeSqlPromise :: SqlString
```

# Config Options
```js
Jobs {
  sql: Function, // Required function that accepts a SQL string and returns a Promise of the results resolving as JSON.
  table: String, // Name of the SQL table. Defaults to "Jobs".
}
Jobs.start {
  intervalMs: Number // Number of milliseconds between checks for jobs to run.
}
```
