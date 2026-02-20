// robots.txt 生成 — 指导搜索引擎爬虫行为

import type { MetadataRoute } from 'next';

export default function robots(): MetadataRoute.Robots {
  return {
    rules: {
      userAgent: '*',
      allow: '/',
      disallow: ['/api/', '/login'],
    },
  };
}
