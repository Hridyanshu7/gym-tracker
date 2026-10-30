# Supabase project

- Project: [gym-tracker](https://supabase.com/dashboard/project/bwavcibrrynjysxzqrto)
- Project ref: `bwavcibrrynjysxzqrto`
- Region: Mumbai (`ap-south-1`)
- Initial migration: `20261030000000_initial_schema_draft.sql` (applied)

The local Supabase CLI is linked to this project. Credentials and the generated database password live only in the ignored root `.env.local` file. The browser app still needs Google sign-in, owner bootstrap, and sync wiring.

## Connect the GitHub repository

The native GitHub integration requires a one-time browser authorization. In the project dashboard, open **Project Settings → Integrations → GitHub Integration**, choose **Authorize GitHub**, then select `Hridyanshu7/gym-tracker`. Set the working directory to `.` and production branch to `main`. Enable **Deploy to production** only after reviewing the migration workflow.

The repository already contains `supabase/config.toml` and the migration under `supabase/migrations/`, so Supabase can read them after authorization.
