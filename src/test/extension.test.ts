import * as assert from "assert";
import * as vscode from "vscode";
// import * as myExtension from '../../extension';

suite("Extension Test Suite", () => {
  vscode.window.showInformationMessage("Start all tests.");

  test("Extension should be present", () => {
    assert.ok(
      vscode.extensions.getExtension("undefined_publisher.filecounter")
    );
  });

  test("Should activate", async () => {
    const ext = vscode.extensions.getExtension(
      "undefined_publisher.filecounter"
    );
    if (ext) {
      await ext.activate();
      assert.strictEqual(ext.isActive, true);
    }
  });

  test("Should register commands", async () => {
    const commands = await vscode.commands.getCommands(true);
    const expectedCommands = ["filecounter.refresh", "filecounter.toggle"];

    expectedCommands.forEach((cmd) => {
      assert.ok(commands.includes(cmd), `Command ${cmd} should be registered`);
    });
  });
});
