import * as vscode from 'vscode';

interface Repo {
  name: string;
  full_name: string;
  private: boolean;
}

type RepoQuickPickItem = vscode.QuickPickItem & { repoFullName: string };

export async function getOctokit(token: string) {

  const { Octokit } = await import("octokit");
  // const { RestEndpointMethodTypes } = await import("@octokit/plugin-rest-endpoint-methods");

  return new Octokit({ auth: token });
}

async function fetchUserRepo(octokit: any): Promise<RepoQuickPickItem[]> {
  try {
    const repos = await octokit.request('GET /user/repos', {
      per_page: 100
    });

    return repos.data.map((repo: any) => ({
      label: repo.name,
      description: repo.private ? 'Private' : 'Public',
      repoFullName: repo.full_name,
    }));

  } catch (error) {
    vscode.window.showErrorMessage("Failed to fetch repositories. Please check your connection or token.");
    console.error("Error fetching repos: ", error);
    return [];
  }
}

async function selectReposForMirroring(token: string, context: vscode.ExtensionContext) {
  const octokit = await getOctokit(token);
  const repos = await fetchUserRepo(octokit);

  if(repos.length === 0) {
    vscode.window.showInformationMessage("No repositories to mirror commits from.");
    return;
  }

  const selected = await vscode.window.showQuickPick(repos, {
    canPickMany: true,
    placeHolder: 'Select repositories to mirror commits from'
  });

  if(selected) {
    const repoName = selected.map((repo) => (repo as RepoQuickPickItem).repoFullName);

    await context.globalState.update('selectedRepo', repoName);
    vscode.window.showInformationMessage(`Selected ${repoName.length} repositories for mirroring.`);

  } else {
    vscode.window.showInformationMessage('No repositories selected.');
  }
}

export { selectReposForMirroring };