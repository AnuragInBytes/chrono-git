import * as vscode from 'vscode';
import { z } from 'zod';
import { GitHubRepoSchema } from './types/schema';

const RepoQuickPickItemSchema = z.object({
  label: z.string(),
  description: z.string(),
  repoFullName: z.string(),
});

type RepoQuickPickItem = z.infer<typeof RepoQuickPickItemSchema>;

const PAGE_SIZE = 100;
const MAX_PAGE = 10;


export async function getOctokit(token: string) {

  try {
    const { Octokit } = await import("octokit");
    return new Octokit({ auth: token });
  } catch (error) {
    throw new Error(`Failed to initialize Octokit: ${error instanceof Error ? error.message : 'Unknown error'}`);
  }
}

async function fetchUserRepo(octokit: any, page: number = 1): Promise<RepoQuickPickItem[]> {
  try {
    const response = await octokit.request('GET /user/repos', {
      per_page: PAGE_SIZE,
      page,
    });

    const repos = z.array(GitHubRepoSchema).parse(response.data);
    const mirrorRepoFullName = vscode.workspace.getConfiguration('chronoGit').get<string>('mirrorRepo');

    return repos
      .filter((repo) => {
        if(!mirrorRepoFullName) {
          // console.log("yaha hai be chutiye");
          return true;
        }
        const normalizedMirrorName = mirrorRepoFullName.toLowerCase();
        const normalizedRepoName = repo.name.toLowerCase();
        // console.log([normalizedMirrorName, normalizedRepoName]);
        return normalizedRepoName !== normalizedMirrorName;
      })
      .map((repo) => ({
      label: repo.name,
      description: repo.private ? 'Private' : 'Public',
      repoFullName: repo.full_name,
    }));
  } catch (error) {
    throw new Error(`Failed to fetch repositories: ${error instanceof Error ? error.message : 'Unknown error'}`);
  }
}

async function fetchAllUserRepos(octokit: any): Promise<RepoQuickPickItem[]> {
  const allRepos: RepoQuickPickItem[] = [];
  let page = 1;

  try {
    while(page < MAX_PAGE) {
      const repos = await fetchUserRepo(octokit, page);
      if(repos.length===0){
        break;
      }

      allRepos.push(...repos);
      if (repos.length < PAGE_SIZE){
        break;
      }
      page++;
    }
    return allRepos;
  } catch (error) {
    throw new Error(`Failed to fetch all repositories: ${error instanceof Error ? error.message : 'Unknown error'}`);
  }
}

async function selectReposForMirroring(token: string, context: vscode.ExtensionContext) {

  try {
    const octokit = await getOctokit(token);
    const repos = await fetchAllUserRepos(octokit);

    if(repos.length === 0) {
      vscode.window.showInformationMessage("No repositories to mirror commits from.");
      return;
    }

    const quickPick = vscode.window.createQuickPick<RepoQuickPickItem>();
    quickPick.items = repos;
    quickPick.canSelectMany = true;
    quickPick.placeholder = 'Select repositories to mirror commits from';

    const selected = await new Promise<readonly RepoQuickPickItem[]>((resolve) => {
      quickPick.onDidAccept(() => {
        resolve(quickPick.selectedItems);
        quickPick.dispose();
      });
      quickPick.show();
    });

    if(selected && selected.length > 0) {
      const repoName = [...selected].map(repo => repo.repoFullName);
      await context.globalState.update('selectedRepos', repoName);
      vscode.window.showInformationMessage(`Selected ${selected.length} repositories for mirroring.`);
    } else {
      vscode.window.showInformationMessage('No Repositories selected.');
    }
  } catch (error) {
    vscode.window.showErrorMessage(`Failed to select repositories: ${error instanceof Error ? error.message : 'Unknown error'}`);
  }
}

export { selectReposForMirroring };