import { z } from "zod";

export const coordinatesSchema = z.object({
  lat: z.number().min(-90).max(90),
  lng: z.number().min(-180).max(180),
});

export const resolveLinksRequestSchema = z.object({
  links: z
    .array(z.string().url("Each entry must be a valid URL"))
    .min(1, "At least one link is required")
    .max(30, "Maximum 30 links at a time"),
});

export const optimizeRouteRequestSchema = z.object({
  origin: coordinatesSchema,
  destinations: z
    .array(
      z.object({
        id: z.string(),
        originalLink: z.string(),
        name: z.string(),
        address: z.string(),
        coordinates: coordinatesSchema,
        placeId: z.string().optional(),
        status: z.literal("resolved"),
        description: z.string().max(300).optional(),
        clientName: z.string().max(100).optional(),
        empreendimento: z.string().max(100).optional(),
      })
    )
    .min(1, "At least one destination is required")
    .max(25, "Maximum 25 destinations"),
});
