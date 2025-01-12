import * as vscode from 'vscode';
import express from 'express';
import dotenv from 'dotenv';
import { Request, Response } from 'express';
import { z } from 'zod';
import { Server } from 'http';
import { OAuthTokenSchema } from './types/schema';
// import { Octokit } from 'octokit';

dotenv.config({ path: __dirname + '/../.env' });
const AUTH_TIMEOUT = 5 * 60 * 1000;

const ConfigSchema = z.object({
    GITHUB_CLIENT_ID: z.string(),
    GITHUB_CLIENT_SECRET: z.string(),
});

const config = ConfigSchema.safeParse({
    GITHUB_CLIENT_ID: process.env.GITHUB_CLIENT_ID,
    GITHUB_CLIENT_SECRET: process.env.GITHUB_CLIENT_SECRET,
});

if(!config.success) {
    vscode.window.showErrorMessage('Github OAuth configuration error. Please check your .env file');
    throw new Error(`Config validation failed: ${config.error.message}`);
}

const { GITHUB_CLIENT_ID: clientId, GITHUB_CLIENT_SECRET: clientSecret } = config.data;


const authorizationUrl = `https://github.com/login/oauth/authorize?client_id=${clientId}&scope=repo,user`;
const tokenUrl = `https://github.com/login/oauth/access_token`;

const server = express();
const port = 8000;
let serverInstance: Server | null = null;
let authTimeout: NodeJS.Timeout | null = null;


export async function authenticate(context: vscode.ExtensionContext) {

    try {
        cleanup();

        vscode.env.openExternal(vscode.Uri.parse(authorizationUrl));
        vscode.window.showInformationMessage("Github Authentication started...");

        authTimeout = setTimeout(() => {
            cleanup();
            vscode.window.showErrorMessage('Authentication timed out. Please try again.');
        }, AUTH_TIMEOUT);

        server.get('/callback', (req: Request, res: Response) => {
            (async () => {
                const code = req.query.code as string;

                if(!code || typeof code !== "string") {
                    console.error("Invalid or missing code in callback.");
                    res.status(400).send("Invalid or missing authorization code.");
                    return;
                }

                if(!code) {
                    res.send(400).send('No code provided.');
                    return;
                }

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

                    if(!tokenResponse.ok) {
                        console.error("Token repose not ok : ", await tokenResponse.text());
                        // console.log(await tokenResponse.json());
                        throw new Error(`Token request failed: ${tokenResponse.statusText}`);
                    }

                    const rawData = await tokenResponse.json();
                    // console.log('Raw token response: ', JSON.stringify(rawData, null, 2));

                    // if(rawData.error) {
                    //     throw new
                    // }
                    const result = OAuthTokenSchema.safeParse(rawData);


                    if (!result.success) {
                        console.error(`Validation error: ${result.error.format()}`);
                        throw new Error('Invalid token respose formate.');
                    }

                    const data = result.data;

                    if(data.error) {
                        vscode.window.showErrorMessage(`Authentication failed: ${data.error_description}`);
                        res.send('Authentication faild.');
                        return;
                    }

                    await context.secrets.store('githubAccessToken', data.access_token);
                    if(data.refresh_token) {
                        await context.secrets.store('githubRefreshToken', data.refresh_token);
                    }

                    res.send('Authentication successful! You can close this tab.');
                    vscode.window.showInformationMessage('Successfully authenticated with GitHub.');

                    cleanup();
                } catch (err) {
                    console.error('Authentication error: ', err);
                    vscode.window.showErrorMessage(`Application failed: ${err instanceof Error ? err.message : 'Unknown error'}`);
                    // console.error(err);
                    res.send('Application failed. Please check you vscode for details.');
                    cleanup();
                }
            })();
        });

        serverInstance = server.listen(port, () => {
            console.log(`OAuth callback server running at http://localhost:${port}`);
        });
    } catch (error) {
        vscode.window.showErrorMessage(`Application failed: ${error instanceof Error ? error.message : 'Unknown error'}`);
        console.error("Auth error: ", error);
        cleanup();
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

        const rawData = await response.json();
        const result = OAuthTokenSchema.safeParse(rawData);
        if (result.error) {
            vscode.window.showErrorMessage(`Authentication failed: Invalid response formate`);
            return;
        }

        const data = result.data;

        if(data.error) {
            vscode.window.showErrorMessage(`Authentication failed: ${data.error_description}`);
            return;
        }

        if(data.error) {
            vscode.window.showErrorMessage(`Token refresh failed: ${data.error_description}`);
            return null;
        }

        await context.secrets.store('githubAccessToken', data.access_token);
        if(data.refresh_token) {
            await context.secrets.store('githubRefreshToken', data.refresh_token);
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

export function cleanup(){
    if (serverInstance) {
        serverInstance.close();
        serverInstance = null;
    }
    if(authTimeout) {
        clearTimeout(authTimeout);
        authTimeout = null;
    }
}