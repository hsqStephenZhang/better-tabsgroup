// Copyright (c) 2022 hsqStephenZhang
//
// This software is released under the MIT License.
// https://opensource.org/licenses/MIT

import * as assert from "assert";
import * as vscode from "vscode";
import * as path from "path";
import * as fs from "fs";
import * as os from "os";
import { getTabUri, isSaveableTab } from "../../../utils/tab";

suite("Tab Types Integration Test Suite", function () {
  this.timeout(20000); // Increase timeout to 20 seconds for slow CI environments

  let tempDir: string;
  let testFiles: { [key: string]: string } = {};

  async function waitForActiveTab(timeoutMs = 5000): Promise<vscode.Tab> {
    const start = Date.now();
    while (Date.now() - start < timeoutMs) {
      const activeTab = vscode.window.tabGroups.activeTabGroup.activeTab;
      if (activeTab) {
        return activeTab;
      }
      await new Promise((resolve) => setTimeout(resolve, 100));
    }
    const currentActive = vscode.window.tabGroups.activeTabGroup.activeTab;
    if (currentActive) {
      return currentActive;
    }
    throw new Error("Timeout waiting for active tab to open");
  }

  suiteSetup(async () => {
    // Create temp directory with test files
    tempDir = fs.mkdtempSync(path.join(os.tmpdir(), "onetab-test-"));

    // Create test files of different types
    testFiles = {
      typescript: path.join(tempDir, "test.ts"),
      notebook: path.join(tempDir, "test.ipynb"),
      json: path.join(tempDir, "test.json"),
    };

    fs.writeFileSync(testFiles.typescript, "const x = 1;");
    fs.writeFileSync(
      testFiles.notebook,
      JSON.stringify({
        cells: [],
        metadata: {},
        nbformat: 4,
        nbformat_minor: 2,
      }),
    );
    fs.writeFileSync(testFiles.json, '{"test": true}');
  });

  suiteTeardown(async () => {
    // Close all editors
    await vscode.commands.executeCommand("workbench.action.closeAllEditors");

    // Clean up temp files
    Object.values(testFiles).forEach((file) => {
      if (fs.existsSync(file)) {
        fs.unlinkSync(file);
      }
    });
    if (fs.existsSync(tempDir)) {
      fs.rmdirSync(tempDir);
    }
  });

  test("should open and identify text file tab", async () => {
    const uri = vscode.Uri.file(testFiles.typescript);
    await vscode.commands.executeCommand("vscode.open", uri);

    // Wait for tab to be created
    const activeTab = await waitForActiveTab();
    assert.ok(activeTab, "Active tab should exist");
    assert.ok(
      activeTab.input instanceof vscode.TabInputText,
      "Should be TabInputText",
    );

    const extractedUri = getTabUri(activeTab);
    assert.strictEqual(extractedUri?.fsPath, uri.fsPath);
    assert.strictEqual(isSaveableTab(activeTab), true);

    await vscode.commands.executeCommand("workbench.action.closeActiveEditor");
  });

  test("should open and identify notebook file tab", async function () {
    // Skip if Jupyter extension is not installed
    const jupyterExt = vscode.extensions.getExtension("ms-toolsai.jupyter");
    if (!jupyterExt) {
      this.skip();
      return;
    }

    const uri = vscode.Uri.file(testFiles.notebook);
    await vscode.commands.executeCommand("vscode.open", uri);

    const activeTab = await waitForActiveTab(10000);
    assert.ok(activeTab, "Active tab should exist");

    // Note: May be TabInputNotebook or TabInputText depending on extension
    const extractedUri = getTabUri(activeTab);
    assert.ok(extractedUri, "Should extract URI from notebook tab");
    assert.strictEqual(isSaveableTab(activeTab), true);

    await vscode.commands.executeCommand("workbench.action.closeActiveEditor");
  });

  test("should handle diff view tabs", async () => {
    const uri1 = vscode.Uri.file(testFiles.typescript);
    const uri2 = vscode.Uri.file(testFiles.json);

    // Open diff view
    await vscode.commands.executeCommand(
      "vscode.diff",
      uri1,
      uri2,
      "Diff Test",
    );

    const activeTab = await waitForActiveTab();
    assert.ok(activeTab, "Active tab should exist");

    if (activeTab.input instanceof vscode.TabInputTextDiff) {
      const extractedUri = getTabUri(activeTab);
      assert.ok(extractedUri, "Should extract URI from diff tab");
      assert.strictEqual(
        extractedUri.fsPath,
        uri2.fsPath,
        "Should return modified URI",
      );
    }

    await vscode.commands.executeCommand("workbench.action.closeActiveEditor");
  });

  test("should identify terminal as non-saveable", async () => {
    // Create a terminal
    const terminal = vscode.window.createTerminal("Test Terminal");
    terminal.show();

    await new Promise((resolve) => setTimeout(resolve, 500));

    // Find the terminal tab
    const allTabs = vscode.window.tabGroups.all.flatMap((g) => g.tabs);
    const terminalTab = allTabs.find(
      (t) => t.input instanceof vscode.TabInputTerminal,
    );

    if (terminalTab) {
      assert.strictEqual(getTabUri(terminalTab), undefined);
      assert.strictEqual(isSaveableTab(terminalTab), false);
    }

    terminal.dispose();
  });
});
