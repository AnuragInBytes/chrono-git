import * as vscode from 'vscode';
import { getOctokit } from './repoSelection';

interface commitData {
  sha: string;
  commit: {
    message: string;
    author: {
      date: string;
    };
  };
  html_url: string;
}

export async function ensureMirrorRepo(context: vscode.ExtensionContext) {

  const { Octokit } = await import("octokit");

  const token = await context.secrets.get("githubAccessToken");
  if(!token) {
    vscode.window.showErrorMessage("No tokens found. Please authenticate.");
    return;
  }

  const octokit = new Octokit({ auth: token });
  const mirrorRepoOwner = vscode.workspace.getConfiguration('chronoGit').get<string>('mirrorRepoOwner');

  if(!mirrorRepoOwner) {
    try {
      const { data: user } = await octokit.request('GET /user');
      const config = vscode.workspace.getConfiguration('chronoGit');
      await config.update('mirrorRepoOwner', user.login, vscode.ConfigurationTarget.Global);
      vscode.window.showInformationMessage(`Mirror repository owner set to ${user.login}`);
    } catch (error) {
      vscode.window.showErrorMessage("Failed to fetch user information. Please configure mirrorRepoOwner manually.");
      console.error(error);
    }
  }


  const mirrorRepoName = 'commit-mirror';
  const user = await octokit.request('GET /user');

  try {
    await octokit.request('GET /repos/{owner}/{repo}', {
      owner: user.data.login,
      repo: mirrorRepoName,
    });
    console.log("Mirror repo exists.");
  } catch (error) {
    await octokit.request('POST /user/repos', {
      name: mirrorRepoName,
      private: false,
      description: 'Mirror repo for tracking contribution',
    });
    vscode.window.showInformationMessage('Mirror repo created!');
  }

}

// Fetch latest commits from a repo
async function fetchLatestCommit(octokit: any, repoFullName: string): Promise<commitData[]> {
  try {
    const response = await octokit.rest.repos.listCommits({
      owner: repoFullName.split('/')[0],
      repo: repoFullName.split('/')[1],
      per_page: 10
    });
    return response.data;
  } catch (error) {
    vscode.window.showErrorMessage(`Failed to fetch commits from ${repoFullName}`);
    console.error("Error fetching commits: ", error);
    return [];
  }
}

function parseRepoFullName(repoFullName: string): { repoOwner: string, repoName: string } {
  const [repoOwner, repoName] = repoFullName.split('/');
  if(!repoOwner || !repoName) {
    throw new Error(`Invalid repository name: ${repoFullName}`);
  }
  return { repoName, repoOwner };
}

//push commit mata data to mirror repo
async function mirrorCommitToRepo(octokit: any, commit: commitData, mirrorRepoName: string) {
  // const content = `Commit: ${commit.commit.message}\nDate: ${commit.commit.author.date}\nRepo: ${commit.html_url}`;
  // const path = `${commit.sha}}.txt`;
  const { repoName, repoOwner } = parseRepoFullName(mirrorRepoName);
  const content = `# Mirrored Commit\n\nCommit: ${commit.sha}\nMessage: ${commit.commit.message}`;
  const path = `commits/${commit.sha}.md`;

  try {
    let sha: string | undefined;
    try {
      const fileResponse = await octokit.rest.repos.getContent({
        owner: repoOwner,
        repo: repoName,
        path
      });

      if(Array.isArray(fileResponse.data)) {
        throw new Error('Unexpected response: file path is directory.');
      }

      sha = fileResponse.data.sha;
    } catch (error: any) {
      if(error.status !== 404) {
        throw error;
      }
      sha = undefined;
    }

    await octokit.rest.repos.createOrUpdateFileContents({
      owner: repoOwner,
      repo: repoName,
      path,
      message: `Mirror commit - ${commit.sha}`,
      content: Buffer.from(content).toString('base64'),
      committer: {
        name: 'ChronoGit',
        email: 'chronogit@mirror.com'
      },
      author: {
        name: 'ChronoGit',
        email: 'chronogit@mirror.com'
      },
      sha,
    });
    vscode.window.showInformationMessage(`Commit ${commit.sha} mirrored successfully.`);
  } catch (error: any) {
    vscode.window.showErrorMessage(`Failed to mirror commits ${commit.sha}: ${error.message}`);
    console.error("Error mirroring commits: ", error);
  }
}

export async function mirrorRepos(context: vscode.ExtensionContext) {

  const token = await context.secrets.get('githubAccessToken');
  if(!token) {
    vscode.window.showErrorMessage("No token found. Please authenticate.");
    return;
  }

  const octokit = await getOctokit(token);
  const selectedRepos = context.globalState.get<string[]>('selectedRepo') || [];
  const mirrorRepoName = vscode.workspace.getConfiguration('chronoGit').get<string>('mirrorRepo');

  if(!mirrorRepoName) {
    vscode.window.showErrorMessage("Mirror repo not configured. Please setup in settings.");
    return;
  }

  for(const repo of selectedRepos) {
    const commits = await fetchLatestCommit(octokit, repo);

    for(const commit of commits) {

      try {
        await mirrorCommitToRepo(octokit, commit, mirrorRepoName);
      } catch (error: any) {
        if(error.status === 404) {
          vscode.window.showWarningMessage(`File not found in ${mirrorRepoName}. Creating new file.`);

          const content = `# Mirrored Commit\n\nCommit: ${commit.sha}\nMessage: ${commit.commit.message}`;
          const path = `commits/${commit.sha}.md`;

          try {
            await octokit.rest.repos.createOrUpdateFileContents({
              owner: vscode.workspace.getConfiguration('chronoGit').get<string>('mirrorRepoOwner') || '',
              repo: mirrorRepoName,
              path: path,
              message: `Mirror commit ${commit.sha}`,
              content: Buffer.from(content).toString('base64'),
              committer: {
                name: 'Chrono Git',
                email: 'chrono-git@gmail.com'
              },
              author: {
                name: 'Chrono Git',
                email: 'chrono-git@gmail.com'
              }
            });

            vscode.window.showInformationMessage(`Creating commit file for ${commit.sha} in ${mirrorRepoName}`);
          } catch (createError) {
            vscode.window.showErrorMessage(`Failed to create file for ${mirrorRepoName}: ${createError}`);
          }
        } else {
          vscode.window.showErrorMessage(`Error mirroring commits: ${error}`);
        }
      }
    }
  }

  vscode.window.showInformationMessage('Commit mirroring completed.');

}
