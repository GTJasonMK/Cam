// sitemap.xml 生成 — 列出所有公开页面路由

import type { MetadataRoute } from 'next';

export default function sitemap(): MetadataRoute.Sitemap {
  const baseUrl = process.env.NEXT_PUBLIC_BASE_URL || 'http://localhost:3000';

  return [
    { url: baseUrl, lastModified: new Date(), changeFrequency: 'always', priority: 1 },
    { url: `${baseUrl}/tasks`, lastModified: new Date(), changeFrequency: 'always', priority: 0.8 },
    { url: `${baseUrl}/workers`, lastModified: new Date(), changeFrequency: 'hourly', priority: 0.7 },
    { url: `${baseUrl}/workers/terminal`, lastModified: new Date(), changeFrequency: 'hourly', priority: 0.7 },
    { url: `${baseUrl}/agents`, lastModified: new Date(), changeFrequency: 'weekly', priority: 0.6 },
    { url: `${baseUrl}/events`, lastModified: new Date(), changeFrequency: 'always', priority: 0.5 },
    { url: `${baseUrl}/templates`, lastModified: new Date(), changeFrequency: 'weekly', priority: 0.5 },
    { url: `${baseUrl}/pipelines`, lastModified: new Date(), changeFrequency: 'weekly', priority: 0.5 },
    { url: `${baseUrl}/repos`, lastModified: new Date(), changeFrequency: 'weekly', priority: 0.5 },
    { url: `${baseUrl}/settings`, lastModified: new Date(), changeFrequency: 'monthly', priority: 0.3 },
  ];
}
