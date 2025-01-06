import vscode from 'vscode';
import express from 'express';
import dotenv from 'dotenv';
import { Request, Response } from 'express';
// import { Octokit } from 'octokit';

dotenv.config({ path: __dirname + '/../.env' });

const clientId = process.env.GITHUB_CLIENT_ID as string;
const clientSecret = process.env.GITHUB_CLIENT_SECRET as string;

console.log('Client ID:', process.env.GITHUB_CLIENT_ID);
console.log('Client Secret:', process.env.GITHUB_CLIENT_SECRET);


if (!clientId || !clientSecret) {
    vscode.window.showErrorMessage('GitHub OAuth configuration error. Please check your .env file.');
    throw new Error('GitHub OAuth configuration error.');
}

const authorizationUrl = `https://github.com/login/oauth/authorize?client_id=${clientId}&scope=repo,user`;
const tokenUrl = `https://github.com/login/oauth/access_token`;

const server = express();
const port = 8000;
let serverInstance: any;

interface OAuthTokenResponse{
    access_token: string,
    refresh_token?: string,
    token_type: string,
    scope: string,
    error?: string,
    error_description?: string
}

export async function authenticate(context: vscode.ExtensionContext) {

    // const { OAuthApp } = await import("@octokit/oauth-app");
    // const open = (await import('open')).default;

    try {
        vscode.env.openExternal(vscode.Uri.parse(authorizationUrl));
        vscode.window.showInformationMessage("Github Authentication started...");

        server.get('/callback', (req: Request, res: Response) => {
            (async () => {
                const code = req.query.code as string;

                try {
                    const tokenResponse = await fetch(tokenUrl, {
                        method: 'POST',
                        headers: {
                            Accept: 'application/json',
                            'Content-Type': 'application/json',
                        },
                        body: JSON.stringify({
                            client_id: clientId,
                            client_secret: clientSecret,
                            code,
                        }),
                    });

                    const data = (await tokenResponse.json()) as OAuthTokenResponse;

                    if (data.error) {
                        vscode.window.showErrorMessage(`Authentication failed: ${data.error_description}`);
                        res.send('Authentication failed.');
                        return;
                    }

                    const accessToken = data.access_token;
                    const refreshToken = data.refresh_token;

                    // Store tokens securely
                    await context.secrets.store('githubAccessToken', accessToken);
                    if (refreshToken) {
                        await context.secrets.store('githubRefreshToken', refreshToken);
                    }

                    res.send('Authentication successful! You can close this tab.');
                    vscode.window.showInformationMessage('Successfully authenticated with GitHub.');

                    serverInstance?.close();
                } catch (err) {
                    vscode.window.showErrorMessage('Error during authentication. Please try again.');
                    console.error(err);
                    res.send('Error during authentication.');
                    serverInstance?.close();
                }
            })();
        });

        serverInstance = server.listen(port, () => {
            console.log(`OAuth callback server running at http://localhost:${port}`);
        });
    } catch (error) {
        vscode.window.showErrorMessage("Unexpected error during authentication.");
        console.error("Auth error: ", error);
    }

}

export async function refreshAccessToken(
    context: vscode.ExtensionContext,
): Promise<string | null | undefined> {
    const refreshToken = await context.secrets.get('githubRefreshToken');

    if(!refreshToken) {
        vscode.window.showErrorMessage("No refresh Token found. Re-authenticating...");
        await authenticate(context);
        return null;
    }

    const clientId = process.env.GITHUB_CLIENT_ID!;
    const clientSecret = process.env.GITHUB_CLIENT_SECRET!;

    try {
        const response = await fetch(tokenUrl, {
            method: "POST",
            headers: {
                Accept: 'application/json',
                'Content-Type': 'application/json',
            },
            body: JSON.stringify({
                client_id: clientId,
                client_secret: clientSecret,
                grant_type: 'refresh_token',
                refresh_token: refreshToken
            }),
        });

        const data = (await response.json()) as OAuthTokenResponse;

        if(data.error) {
            vscode.window.showErrorMessage(`Token refresh failed: ${data.error_description}`);
            return null;
        }

        if(data.access_token) {
            await context.secrets.store('githubAccessToken', data.access_token);
            if(data.refresh_token) {
                await context.secrets.store('githubRefreshToken', data.refresh_token);
            }
            vscode.window.showInformationMessage('Token refreshed successfullyl');
            return data.access_token;
        }

    } catch (error) {
        vscode.window.showErrorMessage("Failed to refresh access token.");
        console.error("Token refresh error: ", error);
        await authenticate(context);
    }
    return null;
}

async function makeAuthenticationRequest(context: vscode.ExtensionContext) {
    const { Octokit } = await import("octokit");
    let accessToken = await context.secrets.get('githubAccessToken');

    if(!accessToken) {
        vscode.window.showErrorMessage("No access Toke found. Please authenticate.");
        return;
    }

    const octokit = new Octokit({ auth: accessToken });

    try {
    const user = await octokit.rest.users.getAuthenticated();
    vscode.window.showInformationMessage(`Hello, ${user.data.login}!`);

    } catch (error: any) {
        if(error.status === 401) {
            vscode.window.showWarningMessage("Access Token expired. Refreshing...");
            await refreshAccessToken(context);
        } else {
            vscode.window.showErrorMessage("Failed to fetch user info.");
            console.error('GitHub API error: ', error);
        }
    }
}