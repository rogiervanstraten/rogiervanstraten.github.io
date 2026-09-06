import { defineCollection, z } from 'astro:content';
import { glob } from 'astro/loaders';

const blog = defineCollection({
  loader: glob({ pattern: '**/*.{md,mdx}', base: './src/content/blog' }),
  schema: z.object({
    title: z.string(),
    description: z.string(),
    date: z.coerce.date(),
    draft: z.boolean().default(false),
    tags: z.array(z.string()).optional(),
    links: z
      .array(
        z.object({
          href: z.string(),
          title: z.string(),
          subtitle: z.string(),
          kind: z.enum(['github', 'marketplace']),
        })
      )
      .optional(),
  }),
});

export const collections = { blog };
