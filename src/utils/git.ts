import * as vscode from "vscode";
import { Global } from "../global";
import { API } from "../typings/git";
import { DEFAULT_BRANCH_NAME } from "../constant";
import { GitExtension } from "../typings/git";
import { TabsState } from "../model/tabstate";

const pattern = "/.git";

// Global flag to prevent duplicate branch change processing
let isProcessingBranchChange = false;

// the git branch change listener, uses vscode's git API to monitor and switch the state
export function reinitGitBranchGroups(git: API): vscode.Disposable | void {
  if (git.repositories.length === 0) {
    return;
  }

  const repo = git.repositories[0];
  let latestBranch = repo.state.HEAD?.name;
  Global.branchName = latestBranch || DEFAULT_BRANCH_NAME;
  
  if (latestBranch) {
    Global.storage.setWorkspaceState("git:lastActiveBranch", latestBranch);
  }

  Global.logger.debug(`reinitGitBranchGroups, current Branch: ${latestBranch}`);

  return repo.state.onDidChange(async () => {
    const toBranch = repo.state.HEAD?.name || DEFAULT_BRANCH_NAME;

    if (toBranch !== Global.branchName) {
      // Prevent duplicate processing if already handling a branch change
      if (isProcessingBranchChange) {
        Global.logger.debug(
          `Branch change already in progress, skipping duplicate event`,
        );
        return;
      }

      isProcessingBranchChange = true;
      try {
        const fromBranch = Global.branchName;
        Global.logger.debug(
          `Branch changed, from: ${fromBranch}, to: ${toBranch}`,
        );

        // Retrieve last active branch from persistent storage
        const lastActiveBranch = Global.storage.getWorkspaceState("git:lastActiveBranch");

        // We only perform the branch switch (archive & load) if:
        // 1. Both fromBranch and toBranch are real branches (not DEFAULT_BRANCH_NAME "none")
        // 2. Or, if we are initializing (fromBranch is "none"), but the user switched branches outside VS Code
        //    (i.e., lastActiveBranch is a real branch different from toBranch)
        const isRealSwitch = 
          fromBranch !== DEFAULT_BRANCH_NAME && toBranch !== DEFAULT_BRANCH_NAME;

        const isExternalSwitch =
          fromBranch === DEFAULT_BRANCH_NAME && 
          lastActiveBranch && 
          lastActiveBranch !== DEFAULT_BRANCH_NAME &&
          lastActiveBranch !== toBranch;

        if (isRealSwitch || isExternalSwitch) {
          const archiveBranch = isRealSwitch ? fromBranch : lastActiveBranch!;

          // Step 1: Save current state to DB under the old branch name
          // Create a deep clone with PRESERVED IDs to prevent duplication
          const currentState = Global.tabsProvider.getState();
          const stateToSave = currentState.deepClone(true);
          stateToSave.branchName = archiveBranch;
          await stateToSave.saveToStorage();
          Global.logger.debug(`Saved state for branch: ${archiveBranch}`);

          // Step 2: Load state for the new branch from DB
          // Reload from storage directly to get the latest persisted state
          const newState = await loadBranchStateFromStorage(toBranch);

          if (newState) {
            Global.logger.debug(`Loading existing state for branch: ${toBranch}`);
            // Use the loaded state directly (already a fresh instance from storage)
            await Global.tabsProvider.resetState(newState);
          } else {
            Global.logger.debug(
              `No existing state for branch: ${toBranch}, creating empty state`,
            );
            await Global.tabsProvider.clearState();
          }
        } else {
          Global.logger.debug(
            `Skipped state archiving/loading for branch transition: ${fromBranch} -> ${toBranch}`,
          );
        }

        // Step 3: Update to new branch name globally and in persistent storage
        Global.branchName = toBranch;
        if (toBranch !== DEFAULT_BRANCH_NAME) {
          await Global.storage.setWorkspaceState("git:lastActiveBranch", toBranch);
        }

        // Step 4: Reload branches provider to reflect changes
        // This ensures the UI is updated with the saved "from" branch
        Global.branchesProvider.reloadState();
      } finally {
        isProcessingBranchChange = false;
      }
    }
  });
}

// Helper function to load branch state directly from storage
async function loadBranchStateFromStorage(
  branchName: string,
): Promise<TabsState | null> {
  const branchNames = Global.storage.listBranches();

  if (branchNames.includes(branchName)) {
    // Load a fresh state from storage
    const state = TabsState.loadFromStorage(branchName);

    // Delete from storage since it's now the active branch
    await Global.storage.deleteBranch(branchName);

    return state;
  }

  return null;
}

// our file watcher to monitor the changes under `.git` folder
// used to detect the initialization of git repository
export class GitFileWatcher {
  private watcher: vscode.FileSystemWatcher;

  constructor() {
    this.watcher = vscode.workspace.createFileSystemWatcher("**/.git{,/**}");
    this.watcher.onDidCreate((uri) => {
      // the creation of .git folder
      if (uri.fsPath.endsWith(pattern) || uri.fsPath.includes(pattern + "/")) {
        const gitExtension =
          vscode.extensions.getExtension<GitExtension>("vscode.git")?.exports;
        const git = gitExtension?.getAPI(1);
        if (git) {
          Global.logger.debug("initializing git branch groups");
          reinitGitBranchGroups(git);
        } else {
          Global.logger.error("failed to get git API");
        }
      }

      Global.logger.debug(uri.fsPath);
    });
    this.watcher.onDidDelete((uri) => {
      // delete of .git folder
      if (uri.fsPath.endsWith(pattern)) {
        Global.branchName = DEFAULT_BRANCH_NAME;
        Global.logger.debug("git folder deleted");
        return;
      }

      // delete of normal files
      let autoClean = vscode.workspace
        .getConfiguration()
        .get("onetab.autoclean") as boolean;

      Global.logger.debug(uri.fsPath);
      if (autoClean) {
        Global.tabsProvider.updateState((state) => {
          state.removeTabFromAllGroups(uri.fsPath);
        });
      }
    });
  }
}
