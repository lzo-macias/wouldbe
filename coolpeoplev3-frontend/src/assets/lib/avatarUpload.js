import api from "./api";

// ============================================================================
// Profile-photo upload: prepare in the browser, PUT straight to R2, register
// for moderation.
//
// Nothing here writes the user's avatar. The server sets profile_photo_url only
// after a moderation verdict — see the backend's syncProfilePhoto. What comes
// back from uploadAvatar() is a content_item in 'pending_moderation'; show the
// local preview until it flips to 'approved'.
// ============================================================================

// What the server hands out a presigned PUT for. Kept in sync with IMAGE_TYPES
// in avatarRoutes.js — a value not on this list is rejected there anyway, this
// just fails faster and with a friendlier message.
export const ACCEPTED_IMAGE_TYPES = "image/png,image/jpeg,image/webp";

const MAX_DIM = 512;         // avatars never render larger than this
const WEBP_QUALITY = 0.85;
const MAX_SOURCE_BYTES = 25 * 1024 * 1024;   // reject absurd originals before decoding

// prepareImage — downscale to MAX_DIM and re-encode as WebP.
//
// TWO reasons, and the second is the important one:
//   1. size. A modern phone photo is 3–8MB; this lands ~30–60KB.
//   2. EXIF. Phone photos carry GPS coordinates. Uploading the original and
//      serving it back publishes where the user took it — for a profile photo,
//      usually where they live. Re-encoding through a canvas drops every
//      metadata block as a side effect of how canvas export works.
//
// Client-side only for responsiveness; the server must not rely on it, since
// anyone can skip the JS and PUT to the presigned URL directly.
export async function prepareImage(file, { maxDim = MAX_DIM, quality = WEBP_QUALITY } = {}) {
    if (!file) throw new Error("No file selected");
    if (!file.type?.startsWith("image/")) throw new Error("That file is not an image");
    if (file.size > MAX_SOURCE_BYTES) throw new Error("That image is too large (25MB max)");

    // createImageBitmap handles orientation and is far faster than an <img> load.
    // Safari <15 lacks the options bag, hence the fallback.
    let bitmap;
    try {
        bitmap = await createImageBitmap(file, { imageOrientation: "from-image" });
    } catch {
        bitmap = await createImageBitmap(file);
    }

    const scale = Math.min(1, maxDim / Math.max(bitmap.width, bitmap.height));
    const width = Math.round(bitmap.width * scale);
    const height = Math.round(bitmap.height * scale);

    const canvas = document.createElement("canvas");
    canvas.width = width;
    canvas.height = height;
    const ctx = canvas.getContext("2d");
    ctx.drawImage(bitmap, 0, 0, width, height);
    bitmap.close?.();

    const blob = await new Promise((resolve, reject) => {
        canvas.toBlob(
            (b) => (b ? resolve(b) : reject(new Error("Could not process that image"))),
            "image/webp",
            quality
        );
    });

    return blob;
}

// uploadAvatar — the whole flow. Returns the content_item (pending_moderation).
//
// Step 2 is a bare fetch, NOT the api instance: the presigned URL is R2's, and
// sending our Authorization header to a third-party origin would leak the token.
// It also must be a raw PUT with no extra headers — the signature covers the
// content type, so anything else invalidates it.
export async function uploadAvatar(file, { onProgress } = {}) {
    onProgress?.("preparing");
    const blob = await prepareImage(file);
    const contentType = blob.type || "image/webp";

    onProgress?.("requesting");
    const { data: presigned } = await api.post("/api/users/me/avatar-upload-url", { contentType });

    if (blob.size > presigned.maxBytes) {
        throw new Error("That image is too large after processing — try a smaller one");
    }

    onProgress?.("uploading");
    const put = await fetch(presigned.uploadUrl, {
        method: "PUT",
        body: blob,
        headers: { "Content-Type": contentType },
    });
    if (!put.ok) throw new Error(`Upload failed (${put.status})`);

    onProgress?.("registering");
    const { data: item } = await api.post("/api/users/me/avatar", {
        objectKey: presigned.objectKey,
        mime_type: contentType,
        file_size_bytes: blob.size,
    });

    onProgress?.("pending");
    return item;
}

// getAvatarStatus — poll target while the badge reads "pending review".
// Returns null when the user has never uploaded one.
export async function getAvatarStatus() {
    const { data } = await api.get("/api/users/me/avatar");
    return data;
}

// Human-readable state for the UI. 'pending_upload' is included because a
// half-finished upload leaves the row there and the user deserves better than
// a silently missing photo.
export function describeAvatarStatus(status) {
    switch (status) {
        case "approved":            return { label: "", tone: "ok" };
        case "pending_upload":      return { label: "Upload didn't finish — try again", tone: "warn" };
        case "pending_moderation":  return { label: "Pending review", tone: "info" };
        case "pending_human_review":
        case "flagged":             return { label: "Being reviewed", tone: "info" };
        case "rejected":            return { label: "This photo wasn't approved", tone: "error" };
        case "removed":             return { label: "This photo was removed", tone: "error" };
        default:                    return { label: "", tone: "ok" };
    }
}
