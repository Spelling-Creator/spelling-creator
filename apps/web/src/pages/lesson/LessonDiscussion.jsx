// The discussion tab (/hub/:id/discussion): comments and the star rating.
//
// It has its own tab rather than sitting under the lesson because the comment
// box is a rich-text editor with its own toolbar, and a reader scrolling to the
// end of a long lesson would meet it whether or not they wanted to write
// anything. The overview's rail keeps the rating summary, so the social proof
// is still on the page someone lands on.
//
// Reading width, not page width — this is prose people write to each other.
//
// On a server-rendered load the Worker has already fetched the thread (see
// apps/api/src/routes/ssr.js), so it arrives in the HTML rather than after a
// skeleton, which is also what lets the lesson's comment markup describe
// content that is really on the page.

import PageBody from "../../components/layout/PageBody.jsx";
import CommentsSection from "../../components/CommentsSection.jsx";
import { useLesson } from "./LessonLayout.jsx";

export default function LessonDiscussion() {
  const { lesson, handleRated, serverComments } = useLesson();

  return (
    <PageBody width="reading">
      <CommentsSection
        lessonId={lesson.id}
        onRated={handleRated}
        initialComments={serverComments}
      />
    </PageBody>
  );
}
