CREATE TYPE "public"."caisse_session_status" AS ENUM('open', 'closed');--> statement-breakpoint
CREATE TABLE "caisse_sessions" (
	"id" serial PRIMARY KEY NOT NULL,
	"caisse_id" integer NOT NULL,
	"store_id" integer NOT NULL,
	"status" "caisse_session_status" DEFAULT 'open' NOT NULL,
	"opened_at" timestamp DEFAULT now() NOT NULL,
	"closed_at" timestamp,
	"opening_balance" numeric(12, 2) NOT NULL,
	"theoretical_closing_balance" numeric(12, 2),
	"actual_closing_balance" numeric(12, 2),
	"ecart" numeric(12, 2),
	"opened_by_user_id" integer NOT NULL,
	"closed_by_user_id" integer,
	"notes" text,
	"created_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "caisse_sessions" ADD CONSTRAINT "caisse_sessions_caisse_id_caisses_id_fk" FOREIGN KEY ("caisse_id") REFERENCES "public"."caisses"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "caisse_sessions" ADD CONSTRAINT "caisse_sessions_store_id_stores_id_fk" FOREIGN KEY ("store_id") REFERENCES "public"."stores"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "caisse_sessions" ADD CONSTRAINT "caisse_sessions_opened_by_user_id_users_id_fk" FOREIGN KEY ("opened_by_user_id") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "caisse_sessions" ADD CONSTRAINT "caisse_sessions_closed_by_user_id_users_id_fk" FOREIGN KEY ("closed_by_user_id") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;