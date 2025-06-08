import { describe, expect, it, beforeAll, beforeEach } from 'vitest'
import { importer } from '@dbml/core'

describe('dbml', () => {
	it('should converts schema less tables', () => {
		const combined = `
      set search_path to config, extensions;

      create table if not exists features (
        id                       uuid primary key default uuid_generate_v4()
      , title                    varchar
      , modified_at              timestamp with time zone not null default now()
      , modified_by              varchar
      );

      set search_path to public, config, extensions;
      create table if not exists feature_states (
        feature_id               uuid references features(id)
      , enabled                  boolean default false
      , data                     jsonb
      , updated_at               timestamp with time zone not null default now()
      , modified_by              varchar
      , constraint feature_states_pkey primary key (feature_id)
      );
      `

		const dbml = importer.import(combined, 'postgres')
		expect(dbml).toEqual(`Table "features" {
  "id" uuid [pk, default: \`uuid_generate_v4()\`]
  "title" varchar
  "modified_at" timestamp [not null, default: \`now()\`]
  "modified_by" varchar
}

Table "feature_states" {
  "feature_id" uuid
  "enabled" boolean [default: false]
  "data" jsonb
  "updated_at" timestamp [not null, default: \`now()\`]
  "modified_by" varchar

  Indexes {
    feature_id [pk, name: "feature_states_pkey"]
  }
}

Ref:"features"."id" < "feature_states"."feature_id"
`)
	})

	it('should converts tables with schema', () => {
		const combined = `
      set search_path to config, extensions;

      create table if not exists config.features (
        id                       uuid primary key default uuid_generate_v4()
      , title                    varchar
      , modified_at              timestamp with time zone not null default now()
      , modified_by              varchar
      );

      comment on column config.features.id IS 'unique id of features';

      set search_path to public, config, extensions;
      create table if not exists public.feature_states (
        feature_id               uuid references config.features(id)
      , enabled                  boolean default false
      , data                     jsonb
      , updated_at               timestamp with time zone not null default now()
      , modified_by              varchar
      , constraint feature_states_pkey primary key (feature_id)
      );

      comment on column feature_states.data is 'json containing the settings';
      `

		const dbml = importer.import(combined, 'postgres')
		expect(dbml).toEqual(`Table "config"."features" {
  "id" uuid [pk, default: \`uuid_generate_v4()\`, note: 'unique id of features']
  "title" varchar
  "modified_at" timestamp [not null, default: \`now()\`]
  "modified_by" varchar
}

Table "feature_states" {
  "feature_id" uuid
  "enabled" boolean [default: false]
  "data" jsonb [note: 'json containing the settings']
  "updated_at" timestamp [not null, default: \`now()\`]
  "modified_by" varchar

  Indexes {
    feature_id [pk, name: "feature_states_pkey"]
  }
}

Ref:"config"."features"."id" < "feature_states"."feature_id"
`)
	})
})
