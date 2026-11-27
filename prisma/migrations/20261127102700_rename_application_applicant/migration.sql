ALTER TABLE "AuthorApplication"
DROP CONSTRAINT "AuthorApplication_applicationId_fkey";

ALTER TABLE "AuthorApplication"
RENAME COLUMN "applicationId" TO "applicantId";

ALTER TABLE "AuthorApplication"
ADD CONSTRAINT "AuthorApplication_applicantId_fkey"
FOREIGN KEY ("applicantId") REFERENCES "User"("id")
ON DELETE CASCADE ON UPDATE CASCADE;
