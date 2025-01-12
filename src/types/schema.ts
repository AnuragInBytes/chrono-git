import { z } from 'zod';

export const OAuthTokenSchema = z.object({
  access_token: z.string(),
  refresh_token: z.string().optional(),
  token_type: z.string(),
  scope: z.string(),
  error: z.string().optional(),
  error_description: z.string().optional(),
}).passthrough();

export const GitHubUserSchema = z.object({
  login: z.string(),
  id: z.number(),
  avatar_url: z.string(),
  html_url: z.string(),
});

export const GitHubRepoSchema = z.object({
  name: z.string(),
  full_name: z.string(),
  private: z.boolean(),
  html_url: z.string(),
  description: z.string().nullable(),
});

export const GitHubCommitSchema = z.object({
  sha: z.string(),
  commit: z.object({
    message: z.string(),
    author: z.object({
      date: z.string(),
    })
  }),
  html_url: z.string(),
});

export type OAuthTokenSchema = z.infer<typeof OAuthTokenSchema>;
export type GitHubUserSchema = z.infer<typeof GitHubUserSchema>;
export type GitHubRepoSchema = z.infer<typeof GitHubRepoSchema>;
export type GitHubCommitSchema = z.infer<typeof GitHubCommitSchema>;
