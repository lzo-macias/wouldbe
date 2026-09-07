import api from "./api";

// ============================================================================
// The optional image on a written post — a question or an artifact.
//
// SAME CONTRACT AS THE AVATAR AND PLAN-IMAGE FLOWS: prepare in the browser, PUT
// straight to R2 with a presigned URL, hand the object key back, and let the
// server bind it to the row. The bytes never pass through our API.
//
// WHAT IS DIFFERENT is the ORDER, and it is deliberate. A plan component uploads
// its image before the component exists. A post is created first and the image is
// attached in the same request, because the post is the words: if the upload
// fails there is still a question worth publishing, and losing what somebody
// wrote over a bad photo would be the worse outcome by a wide margin.
//
// NOTHING HERE MAKES AN IMAGE VISIBLE. posts.image_url is written only by the
// server on a moderation verdict (contentItems.syncPostImage), so the card shows
// the local preview until the real one clears — never a URL we assumed.
//
// The blob arrives ALREADY PREPARED by ImagePicker: downscaled to 1600px and
// re-encoded to WebP, which strips EXIF. Phone photos carry GPS and a post image
// is public.
// ============================================================================

// uploadPostImage — takes ImagePicker's value ({ blob, name, previewUrl }) and
// returns the three fields POST /api/posts expects. Returns {} for no image, so
// it spreads harmlessly into the payload either way.
export async function uploadPostImage(image, { onProgress } = {}) {
    if (!image?.blob) return {};

    const contentType = image.blob.type || "image/webp";

    onProgress?.("requesting");
    const { data: presigned } = await api.post("/api/posts/image-upload-url", { contentType });

    if (image.blob.size > presigned.maxBytes) {
        throw new Error("That image is too large after processing — try a smaller one");
    }

    onProgress?.("uploading");
    // Bare fetch, not the api instance: the presigned URL is R2's origin, and our
    // Authorization header must not be sent to a third party. The signature covers
    // Content-Type, so no other headers may be added.
    const put = await fetch(presigned.uploadUrl, {
        method: "PUT",
        body: image.blob,
        headers: { "Content-Type": contentType },
    });
    if (!put.ok) throw new Error(`Upload failed (${put.status})`);

    onProgress?.("");
    return {
        image_object_key: presigned.objectKey,
        image_mime_type: contentType,
        image_file_size_bytes: image.blob.size,
    };
}
