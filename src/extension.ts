// The module 'vscode' contains the VS Code extensibility API
// Import the module and reference it with the alias vscode in your code below
import * as vscode from "vscode";
import * as fs from "fs";
import * as path from "path";
import ignore from "ignore";

// File counter decorator provider
class FileCounterDecorationProvider implements vscode.FileDecorationProvider {
  private _onDidChangeFileDecorations: vscode.EventEmitter<
    vscode.Uri | vscode.Uri[]
  > = new vscode.EventEmitter<vscode.Uri | vscode.Uri[]>();
  readonly onDidChangeFileDecorations: vscode.Event<vscode.Uri | vscode.Uri[]> =
    this._onDidChangeFileDecorations.event;

  private fileCountCache = new Map<string, number>();
  private gitignoreCache = new Map<string, any>();

  provideFileDecoration(uri: vscode.Uri): vscode.FileDecoration | undefined {
    if (uri.scheme !== "file") {
      return undefined;
    }

    const filePath = uri.fsPath;

    try {
      const stat = fs.statSync(filePath);
      if (!stat.isDirectory()) {
        return undefined;
      }

      // Check if this directory should be ignored
      if (this.shouldIgnoreDirectory(filePath)) {
        return undefined;
      }

      const fileCount = this.getFileCount(filePath);
      const config = vscode.workspace.getConfiguration("filecounter");
      const showZeroCounts = config.get<boolean>("showZeroCounts", false);

      if (fileCount === 0 && !showZeroCounts) {
        return undefined;
      }

      return {
        badge: fileCount.toString(),
        tooltip: `${fileCount} file${
          fileCount === 1 ? "" : "s"
        } in this folder`,
      };
    } catch (error) {
      return undefined;
    }
  }

  private shouldIgnoreDirectory(dirPath: string): boolean {
    const config = vscode.workspace.getConfiguration("filecounter");
    const ignorePatterns = config.get<string[]>("ignorePatterns", []);
    const respectGitignore = config.get<boolean>("respectGitignore", true);
    const includeHiddenFiles = config.get<boolean>("includeHiddenFiles", false);

    // Get directory name
    const dirName = path.basename(dirPath);

    // Check if hidden directory should be ignored
    if (!includeHiddenFiles && dirName.startsWith(".")) {
      console.log(`FileCounter: Ignoring hidden directory: ${dirName}`);
      return true;
    }

    // Create ignore instance for checking directory patterns
    const ig = ignore().add(ignorePatterns);

    // Add gitignore patterns if enabled
    if (respectGitignore) {
      const gitignorePatterns = this.getGitignorePatterns(
        path.dirname(dirPath)
      );
      if (gitignorePatterns.length > 0) {
        ig.add(gitignorePatterns);
      }
    }

    // Find workspace root to get relative path
    const workspaceFolder = vscode.workspace.getWorkspaceFolder(
      vscode.Uri.file(dirPath)
    );
    if (workspaceFolder) {
      const relativePath = path.relative(workspaceFolder.uri.fsPath, dirPath);

      // Check if the directory itself matches ignore patterns
      if (relativePath && ig.ignores(relativePath)) {
        console.log(
          `FileCounter: Ignoring directory by pattern: ${dirName} (${relativePath})`
        );
        return true;
      }

      // Also check just the directory name for simple patterns like "node_modules"
      if (ig.ignores(dirName)) {
        console.log(
          `FileCounter: Ignoring directory by name pattern: ${dirName}`
        );
        return true;
      }
    }

    return false;
  }

  private getFileCount(dirPath: string): number {
    // Check cache first
    if (this.fileCountCache.has(dirPath)) {
      return this.fileCountCache.get(dirPath)!;
    }

    try {
      const config = vscode.workspace.getConfiguration("filecounter");
      const ignorePatterns = config.get<string[]>("ignorePatterns", []);
      const respectGitignore = config.get<boolean>("respectGitignore", true);
      const includeHiddenFiles = config.get<boolean>(
        "includeHiddenFiles",
        false
      );
      const countSubfolders = config.get<boolean>("countSubfolders", false);

      // Create ignore instance with user patterns
      const ig = ignore().add(ignorePatterns);

      // Add gitignore patterns if enabled
      if (respectGitignore) {
        const gitignorePatterns = this.getGitignorePatterns(dirPath);
        if (gitignorePatterns.length > 0) {
          ig.add(gitignorePatterns);
        }
      }

      const fileCount = this.countFilesInDirectory(
        dirPath,
        ig,
        includeHiddenFiles,
        countSubfolders
      );

      // Cache the result
      this.fileCountCache.set(dirPath, fileCount);
      return fileCount;
    } catch (error) {
      return 0;
    }
  }

  private countFilesInDirectory(
    dirPath: string,
    ig: any,
    includeHiddenFiles: boolean,
    countSubfolders: boolean,
    relativePath: string = ""
  ): number {
    try {
      const items = fs.readdirSync(dirPath);
      let fileCount = 0;

      for (const item of items) {
        // Handle hidden files
        if (!includeHiddenFiles && item.startsWith(".")) {
          continue;
        }

        const itemPath = path.join(dirPath, item);
        const relativeItemPath = relativePath
          ? path.join(relativePath, item)
          : item;

        // Check if item should be ignored
        if (ig.ignores(relativeItemPath)) {
          continue;
        }

        try {
          const stat = fs.statSync(itemPath);

          if (stat.isFile()) {
            fileCount++;
          } else if (stat.isDirectory() && countSubfolders) {
            // Recursively count files in subdirectories
            fileCount += this.countFilesInDirectory(
              itemPath,
              ig,
              includeHiddenFiles,
              countSubfolders,
              relativeItemPath
            );
          }
        } catch {
          // Skip files that can't be accessed
          continue;
        }
      }

      return fileCount;
    } catch (error) {
      return 0;
    }
  }

  private getGitignorePatterns(dirPath: string): string[] {
    // Check cache first
    if (this.gitignoreCache.has(dirPath)) {
      return this.gitignoreCache.get(dirPath);
    }

    const patterns: string[] = [];

    // Find workspace root
    const workspaceFolder = vscode.workspace.getWorkspaceFolder(
      vscode.Uri.file(dirPath)
    );
    if (!workspaceFolder) {
      this.gitignoreCache.set(dirPath, patterns);
      return patterns;
    }

    const workspaceRoot = workspaceFolder.uri.fsPath;
    let currentDir = dirPath;

    // Walk up the directory tree from current directory to workspace root looking for .gitignore files
    while (currentDir && currentDir.startsWith(workspaceRoot)) {
      const gitignorePath = path.join(currentDir, ".gitignore");

      try {
        if (fs.existsSync(gitignorePath)) {
          const gitignoreContent = fs.readFileSync(gitignorePath, "utf8");
          const lines = gitignoreContent
            .split("\n")
            .map((line) => line.trim())
            .filter((line) => line && !line.startsWith("#"));

          patterns.push(...lines);
        }
      } catch (error) {
        // Ignore errors reading gitignore files
      }

      // Move up one directory, but don't go beyond workspace root
      const parentDir = path.dirname(currentDir);
      if (parentDir === currentDir || !parentDir.startsWith(workspaceRoot)) {
        break;
      }
      currentDir = parentDir;
    }

    // Cache the result
    this.gitignoreCache.set(dirPath, patterns);
    return patterns;
  }

  // Clear cache for a specific directory
  public clearCacheForDirectory(dirPath: string): void {
    this.fileCountCache.delete(dirPath);
    this.gitignoreCache.delete(dirPath);
    this._onDidChangeFileDecorations.fire(vscode.Uri.file(dirPath));
  }

  // Clear entire cache
  public clearCache(): void {
    this.fileCountCache.clear();
    this.gitignoreCache.clear();
    this._onDidChangeFileDecorations.fire(vscode.Uri.file(""));
  }

  // Refresh decorations
  public refresh(): void {
    this.clearCache();
  }
}

// This method is called when your extension is activated
// Your extension is activated the very first time the command is executed
export function activate(context: vscode.ExtensionContext) {
  console.log("FileCounter extension is now active!");

  // Create the decoration provider
  const decorationProvider = new FileCounterDecorationProvider();

  // Register the file decoration provider
  const decorationProviderDisposable =
    vscode.window.registerFileDecorationProvider(decorationProvider);

  // Watch for file system changes
  const fileWatcher = vscode.workspace.createFileSystemWatcher("**/*");

  // Refresh when files are created, deleted, or changed
  const onFileCreate = fileWatcher.onDidCreate((uri) => {
    const parentDir = path.dirname(uri.fsPath);
    decorationProvider.clearCacheForDirectory(parentDir);
  });

  const onFileDelete = fileWatcher.onDidDelete((uri) => {
    const parentDir = path.dirname(uri.fsPath);
    decorationProvider.clearCacheForDirectory(parentDir);
  });

  // Register refresh command
  const refreshCommand = vscode.commands.registerCommand(
    "filecounter.refresh",
    () => {
      decorationProvider.refresh();
      vscode.window.showInformationMessage("File counts refreshed!");
    }
  );

  // Register toggle command
  let isEnabled = true;
  const toggleCommand = vscode.commands.registerCommand(
    "filecounter.toggle",
    () => {
      isEnabled = !isEnabled;
      if (isEnabled) {
        decorationProvider.refresh();
        vscode.window.showInformationMessage("File counter enabled");
      } else {
        decorationProvider.clearCache();
        vscode.window.showInformationMessage("File counter disabled");
      }
    }
  );

  // Listen for configuration changes
  const configChangeListener = vscode.workspace.onDidChangeConfiguration(
    (event) => {
      if (event.affectsConfiguration("filecounter")) {
        decorationProvider.refresh();
        vscode.window.showInformationMessage(
          "File counter settings updated - counts refreshed!"
        );
      }
    }
  );

  // Add all disposables to context
  context.subscriptions.push(
    decorationProviderDisposable,
    fileWatcher,
    onFileCreate,
    onFileDelete,
    refreshCommand,
    toggleCommand,
    configChangeListener
  );
}

// This method is called when your extension is deactivated
export function deactivate() {}
