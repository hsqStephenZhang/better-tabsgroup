// filepath: /Users/zc/codespace/js/vscode-onetab/src/test/suite/utils/git.test.ts
// Copyright (c) 2022 hsqStephenZhang
//
// This software is released under the MIT License.
// https://opensource.org/licenses/MIT

import * as assert from "assert";
import * as vscode from "vscode";
import { Global } from "../../../global";
import { DEFAULT_BRANCH_NAME } from "../../../constant";
import { setupTestGlobals, resetTestState } from "../testHelper";
import { TabsState } from "../../../model/tabstate";
import { TabsGroup } from "../../../model/tabsgroup";
import { TabItem } from "../../../model/tabitem";
import { reinitGitBranchGroups } from "../../../utils/git";

suite("Git Utilities Test Suite", () => {
  suiteSetup(() => {
    setupTestGlobals();
  });

  setup(() => {
    resetTestState();
  });

  test("DEFAULT_BRANCH_NAME should be 'none'", () => {
    assert.strictEqual(DEFAULT_BRANCH_NAME, "none");
  });

  test("Global.branchName should be settable", () => {
    Global.branchName = "feature-branch";
    assert.strictEqual(Global.branchName, "feature-branch");

    Global.branchName = DEFAULT_BRANCH_NAME;
    assert.strictEqual(Global.branchName, DEFAULT_BRANCH_NAME);
  });

  test("Branch name should persist across operations", () => {
    const testBranch = "test-feature-branch";
    Global.branchName = testBranch;

    // Simulate some operations
    const state = new TabsState(testBranch);

    assert.strictEqual(Global.branchName, testBranch);
    assert.strictEqual(state.branchName, testBranch);
  });

  test("Git branch detection startup scenario should not wipe tabs", async () => {
    let stateCleared = false;
    let stateReset = false;

    // Create a tabs state with some mock groups
    const initialTabsState = new TabsState(null);
    const group = new TabsGroup("group1");
    group.setLabel("Initial Group");
    initialTabsState.addTabsGroup(group);

    const mockTabsProvider = {
      getState: () => initialTabsState,
      clearState: async () => {
        stateCleared = true;
      },
      resetState: async (newState: TabsState) => {
        stateReset = true;
      },
    } as any;

    const mockBranchesProvider = {
      reloadState: () => {},
    } as any;

    Global.tabsProvider = mockTabsProvider;
    Global.branchesProvider = mockBranchesProvider;

    // Mock Git extension repo where HEAD name starts as undefined (initializing)
    const onDidChangeEmitter = new vscode.EventEmitter<void>();
    const mockRepo = {
      state: {
        HEAD: { name: undefined } as any,
        onDidChange: onDidChangeEmitter.event,
      },
    };
    const mockGit = {
      repositories: [mockRepo],
    } as any;

    // Initialize git branch groups listener
    const disposable = reinitGitBranchGroups(mockGit);

    // Check it initialized branchName to DEFAULT_BRANCH_NAME ("none")
    assert.strictEqual(Global.branchName, DEFAULT_BRANCH_NAME);

    // Simulate Git finishing load and reporting branch "main"
    mockRepo.state.HEAD.name = "main";

    // Fire event
    onDidChangeEmitter.fire();

    // Wait for async handler to run
    await new Promise((resolve) => setTimeout(resolve, 50));

    // The state should NOT be cleared or reset because we switched from 'none' to 'main'
    assert.strictEqual(stateCleared, false, "State should not be cleared");
    assert.strictEqual(stateReset, false, "State should not be reset");
    assert.strictEqual(Global.branchName, "main", "Branch name should be updated to main");

    if (disposable) {
      disposable.dispose();
    }
  });
});
