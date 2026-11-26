ALTER TABLE "User"
ADD COLUMN "name" TEXT NOT NULL DEFAULT 'New User';

UPDATE "User"
SET "name" = split_part("email", '@', 1);

ALTER TABLE "User"
ALTER COLUMN "name" DROP DEFAULT;
