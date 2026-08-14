import api from "./api";
import { prepareImage, ACCEPTED_IMAGE_TYPES } from "./avatarUpload";

export { ACCEPTED_IMAGE_TYPES };

// ============================================================================
// Plan-of-action position images. Same contract as the avatar flow: prepare in
// the browser, PUT straight to R2, then hand the object key back.
//
// The difference is WHEN the image gets bound to its row. A plan component
// doesn't exist yet on the "plan of action" screen — the campaign, then the
// plan, then the component are created afterwards by StartAnOffice. So this
// uploads the bytes and returns a key; the caller carries that key in the
// component payload, and the server registers it for moderation once the
// component row exists.
//
// Nothing here makes an image visible. plan_components.image_url is written only
// by the server on a moderation verdict.
// ============================================================================

// uploadPlanComponentImage — returns { objectKey, mimeType, size, previewUrl }.
// previewUrl is a LOCAL object URL for immediate display; revoke it when the
// component unmounts or the image is replaced.
export async function uploadPlanComponentImage(file, { onProgress } = {}) {
    onProgress?.("preparing");
    // Downscales and re-encodes to WebP, which also strips EXIF — phone photos
    // carry GPS, and a plan image is published on a public campaign page.
    const blob = await prepareImage(file, { maxDim: 1024 });
    const contentType = blob.type || "image/webp";

    onProgress?.("requesting");
    const { data: presigned } = await api.post("/api/plan-components/image-upload-url", { contentType });

    if (blob.size > presigned.maxBytes) {
        throw new Error("That image is too large after processing — try a smaller one");
    }

    onProgress?.("uploading");
    // Bare fetch, not the api instance: the presigned URL is R2's origin, and our
    // Authorization header must not be sent to a third party. The signature
    // covers Content-Type, so no other headers may be added.
    const put = await fetch(presigned.uploadUrl, {
        method: "PUT",
        body: blob,
        headers: { "Content-Type": contentType },
    });
    if (!put.ok) throw new Error(`Upload failed (${put.status})`);

    onProgress?.("");
    return {
        objectKey: presigned.objectKey,
        mimeType: contentType,
        size: blob.size,
        previewUrl: URL.createObjectURL(blob),
    };
}

// toComponentPayload — the image fields POST /api/plans/:id/components expects.
// Returns {} when there's no image, so it spreads harmlessly either way.
export function toComponentPayload(image) {
    if (!image?.objectKey) return {};
    return {
        image_object_key: image.objectKey,
        image_mime_type: image.mimeType,
        image_file_size_bytes: image.size,
    };
}
