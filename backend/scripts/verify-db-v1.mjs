import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import pg from 'pg';

if (process.env.COLLABCANVAS_TEST_DATABASE !== '1' || !process.env.DATABASE_URL) {
  throw new Error('Set COLLABCANVAS_TEST_DATABASE=1 and DATABASE_URL for a disposable database.');
}

const client = new pg.Client({ connectionString: process.env.DATABASE_URL });

async function rejectsConstraint(sql, values, constraint) {
  await client.query('SAVEPOINT expected_failure');
  try {
    await client.query(sql, values);
    assert.fail(`Expected ${constraint} to reject the query`);
  } catch (error) {
    assert.equal(error.constraint, constraint);
  } finally {
    await client.query('ROLLBACK TO SAVEPOINT expected_failure');
    await client.query('RELEASE SAVEPOINT expected_failure');
  }
}

await client.connect();
try {
  await client.query('BEGIN');
  const [owner, editor, outsider] = [randomUUID(), randomUUID(), randomUUID()];
  const [workspace, otherWorkspace] = [randomUUID(), randomUUID()];
  const [task, otherTask] = [randomUUID(), randomUUID()];

  for (const [id, email] of [[owner, 'owner'], [editor, 'editor'], [outsider, 'outsider']]) {
    await client.query(
      'INSERT INTO users (id, email, password_hash, display_name) VALUES ($1, $2, $3, $4)',
      [id, `${email}@example.test`, 'test-hash', email],
    );
  }
  for (const id of [workspace, otherWorkspace]) {
    await client.query('INSERT INTO workspaces (id, name) VALUES ($1, $2)', [id, 'Test workspace']);
  }
  for (const [workspaceId, userId, role] of [
    [workspace, owner, 'owner'],
    [workspace, editor, 'editor'],
    [otherWorkspace, outsider, 'owner'],
  ]) {
    await client.query(
      'INSERT INTO workspace_members (workspace_id, user_id, role) VALUES ($1, $2, $3)',
      [workspaceId, userId, role],
    );
  }
  await rejectsConstraint(
    'UPDATE workspace_members SET role = $1 WHERE workspace_id = $2 AND user_id = $3',
    ['owner', workspace, editor],
    'uq_workspace_members_one_owner',
  );

  for (const id of [task, otherTask]) {
    await client.query(
      'INSERT INTO tasks (id, workspace_id, title, created_by_user_id) VALUES ($1, $2, $3, $4)',
      [id, workspace, 'Test task', owner],
    );
  }
  for (const userId of [owner, editor]) {
    await client.query(
      'INSERT INTO task_assignees (workspace_id, task_id, user_id, assigned_by_user_id) VALUES ($1, $2, $3, $4)',
      [workspace, task, userId, owner],
    );
  }
  const assigneeCount = await client.query(
    'SELECT count(*)::int AS count FROM task_assignees WHERE task_id = $1',
    [task],
  );
  assert.equal(assigneeCount.rows[0].count, 2);
  await rejectsConstraint(
    'INSERT INTO task_assignees (workspace_id, task_id, user_id, assigned_by_user_id) VALUES ($1, $2, $3, $4)',
    [workspace, task, outsider, owner],
    'fk_task_assignees_member',
  );

  const taskNode = randomUUID();
  await client.query(
    "INSERT INTO canvas_nodes (id, workspace_id, node_type, task_id, position_x, position_y, created_by_user_id) VALUES ($1, $2, 'task', $3, 0, 0, $4)",
    [taskNode, workspace, task, owner],
  );
  await rejectsConstraint(
    "INSERT INTO canvas_nodes (workspace_id, node_type, task_id, position_x, position_y, created_by_user_id) VALUES ($1, 'task', $2, 0, 0, $3)",
    [otherWorkspace, task, outsider],
    'fk_canvas_nodes_task',
  );
  await client.query(
    'INSERT INTO task_dependencies (workspace_id, prerequisite_task_id, dependent_task_id, created_by_user_id) VALUES ($1, $2, $3, $4)',
    [workspace, task, otherTask, owner],
  );
  await rejectsConstraint(
    'INSERT INTO task_dependencies (workspace_id, prerequisite_task_id, dependent_task_id, created_by_user_id) VALUES ($1, $2, $2, $3)',
    [workspace, task, owner],
    'ck_task_dependencies_distinct',
  );

  await client.query('DELETE FROM tasks WHERE id = $1', [task]);
  for (const table of ['task_assignees', 'task_dependencies', 'canvas_nodes']) {
    const result = await client.query(`SELECT count(*)::int AS count FROM ${table} WHERE workspace_id = $1`, [workspace]);
    assert.equal(result.rows[0].count, 0, `${table} was not cascaded`);
  }
  console.log('Database v1 constraints passed (transaction rolled back).');
} finally {
  await client.query('ROLLBACK');
  await client.end();
}
