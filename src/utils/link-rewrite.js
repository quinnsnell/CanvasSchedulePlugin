/**
 * Rewrite Canvas course-resource URLs embedded in HTML so they point at
 * the target course's resources after a course copy.
 *
 * Pure function — accepts/returns a string. Idempotent for already-
 * rewritten URLs (since `sourceCourseId` won't appear in them anymore).
 */

const RESOURCE_TYPES = 'assignments|quizzes|files|pages|modules|discussion_topics|module_items';

/**
 * Matches paths of the form `/courses/<sourceCourseId>/<type>/<idOrSlug>`.
 *
 * `remap` is `{ [type]: { [oldId]: newId } }`. Any inner ID that isn't
 * present in the remap is preserved (helpful for pages, whose slugs Canvas
 * preserves across course copies, and for files/assignments we don't have
 * a name match for).
 *
 * `onUnmatched({ type, id })` fires once per occurrence whose inner ID
 * was preserved unchanged.
 */
export function rewriteEmbeddedLinks(html, sourceCourseId, targetCourseId, remap, onUnmatched) {
  if (!html || !sourceCourseId || !targetCourseId) return html;
  const pattern = new RegExp(
    `/courses/${sourceCourseId}/(${RESOURCE_TYPES})/([^"'\\s/?#]+)`,
    'g'
  );
  return html.replace(pattern, (_match, type, idOrSlug) => {
    const map = (remap && remap[type]) || {};
    const newId = map[idOrSlug];
    if (!newId && onUnmatched) onUnmatched({ type, id: idOrSlug });
    return `/courses/${targetCourseId}/${type}/${newId || idOrSlug}`;
  });
}
