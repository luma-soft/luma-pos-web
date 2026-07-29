import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { Pool } from "pg";

const databaseUrl = process.env.DATABASE_URL;
if (!databaseUrl) {
  console.log("customer request/job PostgreSQL concurrency: skipped because DATABASE_URL is unset");
} else {
  const pool = new Pool({ connectionString: databaseUrl, max: 3 });
  const setup = await pool.connect();
  const clientA = await pool.connect();
  const clientB = await pool.connect();
  const projectA = randomUUID();
  const projectB = randomUUID();
  const firstJob = randomUUID();
  const secondJob = randomUUID();
  const firstRequest = randomUUID();
  const secondRequest = randomUUID();
  const pause = (milliseconds) => new Promise((resolve) => setTimeout(resolve, milliseconds));

  async function begin(client) {
    await client.query("BEGIN");
    await client.query("SET LOCAL lock_timeout = '5s'");
  }

  async function rollback(client) {
    try {
      await client.query("ROLLBACK");
    } catch {
      // Connection cleanup below is authoritative.
    }
  }

  try {
    await setup.query(
      `insert into projects (id, name, service_type, service_stage)
       values ($1, $2, 'camera', 'active'), ($3, $4, 'camera', 'active')`,
      [projectA, `request-lock-a-${randomUUID()}`, projectB, `request-lock-b-${randomUUID()}`],
    );
    await setup.query(
      `insert into service_jobs (id, project_id, code, service_type, title)
       values ($1, $2, $3, 'camera', 'Link-first job'),
              ($4, $2, $5, 'camera', 'Move-first job')`,
      [firstJob, projectA, `CV-${randomUUID().slice(0, 20)}`, secondJob, `CV-${randomUUID().slice(0, 20)}`],
    );
    await setup.query(
      `insert into service_customer_requests
        (id, code, project_id, title, contact_name, token_hash, token_expires_at)
       values ($1, $2, $3, 'Link first', 'Customer', $4, now() + interval '1 day'),
              ($5, $6, $3, 'Move first', 'Customer', $7, now() + interval '1 day')`,
      [
        firstRequest,
        `YC-${randomUUID().slice(0, 20)}`,
        projectA,
        randomUUID().replaceAll("-", "").padEnd(64, "a"),
        secondRequest,
        `YC-${randomUUID().slice(0, 20)}`,
        randomUUID().replaceAll("-", "").padEnd(64, "b"),
      ],
    );

    // Interleaving 1: request link owns the job lock; job move waits, then
    // observes the committed link and is rejected.
    await begin(clientA);
    await clientA.query(
      "update service_customer_requests set linked_job_id = $1 where id = $2",
      [firstJob, firstRequest],
    );
    await begin(clientB);
    const moveAfterLink = clientB.query(
      "update service_jobs set project_id = $1 where id = $2",
      [projectB, firstJob],
    ).then(
      () => ({ settled: true, error: null }),
      (error) => ({ settled: true, error }),
    );
    const firstPending = await Promise.race([
      moveAfterLink,
      pause(100).then(() => ({ settled: false, error: null })),
    ]);
    assert.equal(firstPending.settled, false, "job move did not serialize behind link");
    await clientA.query("COMMIT");
    const firstOutcome = await moveAfterLink;
    assert.match(String(firstOutcome.error?.message), /CUSTOMER_REQUEST_JOB_MISMATCH/);
    await rollback(clientB);

    // Interleaving 2: job move owns the job lock; request link waits, then
    // observes the committed destination and is rejected.
    await begin(clientB);
    await clientB.query(
      "update service_jobs set project_id = $1 where id = $2",
      [projectB, secondJob],
    );
    await begin(clientA);
    const linkAfterMove = clientA.query(
      "update service_customer_requests set linked_job_id = $1 where id = $2",
      [secondJob, secondRequest],
    ).then(
      () => ({ settled: true, error: null }),
      (error) => ({ settled: true, error }),
    );
    const secondPending = await Promise.race([
      linkAfterMove,
      pause(100).then(() => ({ settled: false, error: null })),
    ]);
    assert.equal(secondPending.settled, false, "request link did not serialize behind job move");
    await clientB.query("COMMIT");
    const secondOutcome = await linkAfterMove;
    assert.match(String(secondOutcome.error?.message), /CUSTOMER_REQUEST_JOB_MISMATCH/);
    await rollback(clientA);
    console.log("customer request/job PostgreSQL concurrency: both lock interleavings verified");
  } finally {
    await rollback(clientA);
    await rollback(clientB);
    await setup.query("delete from projects where id = any($1::uuid[])", [[projectA, projectB]]);
    setup.release();
    clientA.release();
    clientB.release();
    await pool.end();
  }
}
