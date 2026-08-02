ALTER TYPE "public"."credential_provider" ADD VALUE 'nvidia-nim' BEFORE 'github';--> statement-breakpoint
ALTER TYPE "public"."credential_provider" ADD VALUE 'together' BEFORE 'github';--> statement-breakpoint
ALTER TYPE "public"."credential_provider" ADD VALUE 'deepinfra' BEFORE 'github';--> statement-breakpoint
ALTER TYPE "public"."credential_provider" ADD VALUE 'bitdeer' BEFORE 'github';--> statement-breakpoint
ALTER TYPE "public"."credential_provider" ADD VALUE 'vultr' BEFORE 'github';--> statement-breakpoint
ALTER TYPE "public"."llm_provider" ADD VALUE 'nvidia-nim';--> statement-breakpoint
ALTER TYPE "public"."llm_provider" ADD VALUE 'together';--> statement-breakpoint
ALTER TYPE "public"."llm_provider" ADD VALUE 'deepinfra';--> statement-breakpoint
ALTER TYPE "public"."llm_provider" ADD VALUE 'bitdeer';--> statement-breakpoint
ALTER TYPE "public"."llm_provider" ADD VALUE 'vultr';