import * as vscode from 'vscode';
import { getOctokit } from './repoSelection';
import { z } from 'zod';
import { GitHubCommitSchema } from './types/schema';
import { resolve } from 'path';

const BATCH_SIZE = 5;
const MAX_RETRIES = 3;
const RETRY_DELAY = 1000;

class RateLimiter {
  private queue: Array<() => Promise<void>> = [];
  private processing = false;
  private lastRequest = 0;
  private minDelay = 1000;

  async add(fn: () => Promise<void>) {
    this.queue.push(fn);
    if (!this.processing) {
      this.processing = true;
      await this.processQueue();
    }
  }

  private async processQueue() {
    while(this.queue.length > 0) {
      const now = Date.now();
      const elapsed = now - this.lastRequest;
      if(elapsed < this.minDelay) {
        await new Promise(resolve => setTimeout(resolve, this.minDelay - elapsed));
      };

      const fn =  this.queue.shift();
      if (fn) {
        this.lastRequest = Date.now();
        await fn();
      }
    }
    this.processing = false;
  }
}

const rateLimiter = new RateLimiter();


async function withRetry<T>(operation: () => Promise<T>): Promise<T> {
  let lastError: Error | undefined;

  for(let i = 0; i < MAX_RETRIES; i++) {
    try{
      return await operation();
    } catch (err) {
      lastError = err instanceof Error ? err : new Error(String(err));
      if(err instanceof Error && err.message.includes('rate limit')) {
        await new Promise(resolve => setTimeout(resolve, 60000));
      } else {
        await new Promise(resolve => setTimeout(resolve, RETRY_DELAY * (i + 1)));
      }
    }
  }
  throw lastError || new Error('Operation failed after retries');
}

export async function ensureMirrorRepo(context: vscode.ExtensionContext) {

  const { Octokit } = await import("octokit");

  const token = await context.secrets.get("githubAccessToken");
  if(!token) {
    throw new Error('No token found. Please authenticate.');
  }

  const octokit = new Octokit({ auth: token });
  const config = vscode.workspace.getConfiguration('chronoGit');
  const mirrorRepoOwner = config.get<string>('mirrorRepoOwner');

  if(!mirrorRepoOwner) {
    try {
      const { data: user } = await octokit.request('GET /user');
      await config.update('mirrorRepoOwner', user.login.toLowerCase(), vscode.ConfigurationTarget.Global);
      vscode.window.showInformationMessage(`Mirror repository owner set to ${user.login}`);
    } catch (error) {
      throw new Error(`Failed to fetch user information: --`);
    }
  }

  if(!mirrorRepoOwner) {
    throw new Error("Failed to determine mirror repository owner.");
  }

  let mirrorRepoName = await vscode.window.showInputBox({
    prompt: 'Enter the name of the mirror repository.',
    placeHolder: 'e.g., my-mirror-repo',
  });
  if(mirrorRepoName) {
    config.update('mirrorRepo', mirrorRepoName, vscode.ConfigurationTarget.Global);
    vscode.window.showInformationMessage(`Mirror repositories set to ${mirrorRepoName}`);
  } else{
    mirrorRepoName = 'commit-mirror';
    config.update('mirrorRepo', mirrorRepoName, vscode.ConfigurationTarget.Global);
    vscode.window.showInformationMessage(`Mirror repository set to ${mirrorRepoName}`);
  }
  // const user = await octokit.request('GET /user');

  try {
    await withRetry(async () => {
      try {
        await octokit.request('GET /repos/{owner}/{repo}', {
          owner: mirrorRepoOwner!,
          repo: mirrorRepoName,
        });
        console.log("Mirror repo exist.");
      } catch (error) {
        if(error) {
          if(error instanceof Error && error.message.includes('Not Found')) {
            await octokit.request('POST /user/repos', {
              name: mirrorRepoName,
              private: false,
              description: 'Mirror repo for tracking contribution',
              auto_init: true
            });
            vscode.window.showInformationMessage('Mirror repo created!');
          } else {
            throw error;
          }
        }
      }
    });
  } catch (error) {
    throw new Error(`Failed to ensure mirror repo: ${error instanceof Error ? error.message : 'Unknown error'}`);
  }
}

// Fetch latest commits from a repo
async function fetchLatestCommit(octokit: any, repoFullName: string): Promise<z.infer<typeof GitHubCommitSchema>[]> {
  return withRetry(async () => {
    try {
      const [owner, repo] = repoFullName.split('/');
      const response = await octokit.rest.repos.listCommits({
        owner,
        repo,
        per_page: 10,
      });

      return z.array(GitHubCommitSchema).parse(response.data);
    } catch (error) {
      throw new Error(`Failed to fetch commits from ${repoFullName}: ${error instanceof Error ? error.message : 'Unknown Error'}`);
    }
  });
}


//push commit mata data to mirror repo
async function mirrorCommitToRepo(
  octokit: any,
  commit: z.infer<typeof GitHubCommitSchema>,
  mirrorRepoName: string,
  mirrorRepoOwner: string,
) {

  return rateLimiter.add(async () => {
    const content = `# Mirrored Commit\n\nCommit: ${commit.sha}\nMessage: ${commit.commit.message}\nDate: ${commit.commit.author.date}\nURL: ${commit.html_url}`;
    const path = `commits/${commit.sha}.md`;

    await withRetry(async () => {
      try {
        let sha: string | undefined;
        try {
          const fileResponse = await octokit.rest.repos.getContent({
            owner: mirrorRepoOwner,
            repo: mirrorRepoName,
            path,
          });

          if('sha' in fileResponse.data) {
            sha = fileResponse.data.sha;
          }
        } catch (error) {
          if(!(error instanceof Error && error.message.includes('Not Found'))) {
            throw error;
          }
        }

        await octokit.rest.repos.createOrUpdateFileContents({
          owner: mirrorRepoOwner,
          repo: mirrorRepoName,
          path,
          message: `Mirror commit - ${commit.sha}`,
          content: Buffer.from(content).toString('base64'),
          committer: {
            name: 'chronoGit',
            email: 'chronogit@mirror.com'
          },
          author: {
            name: 'chronoGit',
            email: 'chronogit@mirror.com'
          },
          sha,
        });
      } catch (error) {
        throw new Error(`Failed to mirror commit ${commit.sha}: ${error instanceof Error ? error.message : 'Unknown Error'}`);
      }
    });
  });
}

export async function mirrorRepos(context: vscode.ExtensionContext) {

  const token = await context.secrets.get('githubAccessToken');
  if(!token) {
    throw new Error("No token found. Please authenticate.");
  }

  const octokit = await getOctokit(token);
  const selectedRepos = context.globalState.get<string[]>('selectedRepos') || [];
  const config = vscode.workspace.getConfiguration('chronoGit');
  const mirrorRepoName = config.get<string>('mirrorRepo') || 'commit-mirror';
  const mirrorRepoOwner = config.get<string>('mirrorRepoOwner');

  if(!mirrorRepoOwner) {
    throw new Error("Mirror repo owner not configured. Please setup in settings.");
  }

  let totalProcessed = 0;
  let failure = 0;

  if(selectedRepos.length === 0) {
    console.log("NO repositoies selected for mirroring.");
  }

  try {
    for(let i = 0; i < selectedRepos.length ; i += BATCH_SIZE) {
      const batch = selectedRepos.slice(i, i + BATCH_SIZE);
      await Promise.all(batch.map(async (repo) => {
        try {
          const commits = await fetchLatestCommit(octokit, repo);
          for(const commit of commits){
            try {
              console.log("Processing commit: ", commit.sha);
              await mirrorCommitToRepo(octokit, commit, mirrorRepoName, mirrorRepoOwner);
              totalProcessed++;
            } catch (error) {
              failure++;
              console.error(`Failed to mirror commit: ${error instanceof Error ? error.message : 'Unknown Error'}`);
            }
          }
        } catch (error) {
          failure++;
          console.error(`Failed to process repo ${repo}: ${error instanceof Error ? error.message : 'Unknown Error'}`);
        }
      }));
    }

    const message = `Commit mirroring completed. Processed: ${totalProcessed} commits${failure > 0 ? `, Failed: ${failure}` : ''}`;
    if(failure > 0) {
      vscode.window.showWarningMessage(message);
    } else {
      vscode.window.showInformationMessage(message);
    }
  } catch (error) {
    throw new Error(`Mirror operation failed: ${error instanceof Error ? error.message : 'Unknown error'}`);
  }

}
