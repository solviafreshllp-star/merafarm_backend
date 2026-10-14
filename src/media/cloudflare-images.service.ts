import { Injectable } from '@nestjs/common';

/**
 * Binaries never pass through this API — we only ask Cloudflare Images for
 * a one-time direct-upload URL and hand it to the frontend, which uploads
 * straight to Cloudflare. We persist only the resulting image ID/URL (see
 * CampaignsService.addMediaUrl). See ../MEDIA-STRATEGY.md for the full
 * phased rollout (Images now, Stream for video/live later).
 */
@Injectable()
export class CloudflareImagesService {
  private readonly accountId = process.env.CLOUDFLARE_ACCOUNT_ID;
  private readonly token = process.env.CLOUDFLARE_IMAGES_TOKEN;

  async requestDirectUploadUrl(): Promise<{ id: string; uploadURL: string }> {
    if (!this.accountId || !this.token) {
      throw new Error('CLOUDFLARE_ACCOUNT_ID / CLOUDFLARE_IMAGES_TOKEN environment variables are not set');
    }

    const res = await fetch(
      `https://api.cloudflare.com/client/v4/accounts/${this.accountId}/images/v2/direct_upload`,
      { method: 'POST', headers: { Authorization: `Bearer ${this.token}` } },
    );
    const body: any = await res.json();
    if (!res.ok || !body.success) {
      throw new Error(`Cloudflare Images direct_upload request failed: ${JSON.stringify(body.errors ?? body)}`);
    }
    return { id: body.result.id, uploadURL: body.result.uploadURL };
  }
}
