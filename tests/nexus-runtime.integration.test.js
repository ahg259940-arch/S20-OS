const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const test = require('node:test');

test('N.E.X.U.S. identity, memory, goals, tasks and PETAL run from an isolated copy', async () => {
  const temporaryDirectory = fs.mkdtempSync(path.join(os.tmpdir(), 's20-nexus-integration-'));
  const runtimeRoot = path.join(temporaryDirectory, 'nexus-runtime');
  fs.cpSync(path.resolve(__dirname, '../nexus-runtime-source'), runtimeRoot, { recursive: true });

  try {
    const contextScope = require(path.join(runtimeRoot, 'core/context-scope.js'));
    const context = {
      userId: 's20-fixture',
      displayName: 'S20 fixture',
      universeId: 's20-fixture-world',
      universeName: 'S20 fixture world',
      game: 'minecraft',
      dataRoot: path.join(runtimeRoot, 'contexts/users/s20-fixture/universes/s20-fixture-world')
    };

    await contextScope.runWithContext(context, async () => {
      contextScope.ensureCurrentDataRoot();
      const identity = require(path.join(runtimeRoot, 'core/identity-provider.js')).getIdentity();
      assert.equal(identity.name, 'N.E.X.U.S.');

      const memory = require(path.join(runtimeRoot, 'memory/memory.js'));
      assert.equal(memory.rememberExperience('S20 OS integration check').added, true);
      assert.equal(memory.searchMemory('S20 integration').experiences.length, 1);

      const goal = require(path.join(runtimeRoot, 'core/goals.js'))
        .createGoal('S20 integration goal', 'Fixture goal', 'Automated integration test');
      assert.ok(goal.id);
      const tasks = require(path.join(runtimeRoot, 'core/tasks.js'));
      const task = tasks.createTask(goal.id, 'Fixture task', 'Task for the isolated integration test');
      assert.ok(task.id);
      assert.equal(tasks.startTask(task.id).success, true);
      assert.equal(tasks.reviewTasks(goal.id).pending[0].status, 'in_progress');

      const petal = require(path.join(runtimeRoot, 'security/petal/index.js')).getStatus({ sessionActive: true });
      assert.equal(petal.name, 'N.E.X.U.S. PETAL');
      assert.equal(petal.state, 'partial');
      assert.equal(petal.session.humanAuthenticated, false);
      assert.equal(petal.modules.find(item => item.id === 'hardware-security').status, 'unavailable');
    });

    const persisted = JSON.parse(fs.readFileSync(
      path.join(context.dataRoot, 'memory/memories.json'), 'utf8'
    ));
    assert.equal(persisted.experiences.length, 4);
    assert.equal(fs.existsSync(path.join(runtimeRoot, 'contexts/registry.json')), false);
  } finally {
    fs.rmSync(temporaryDirectory, { recursive: true, force: true });
  }
});
