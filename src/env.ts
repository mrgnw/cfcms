import { defineEnvVars } from '@sveltejs/kit/env';

export const variables = defineEnvVars({
	BLOG_CMS_DB: { schema: (input) => input },
	BLOG_CMS_DEPLOY_STATE_FILE: { schema: (input) => input },
	BLOG_CONTENT_BASE_DIR: { schema: (input) => input },
	BLOG_BUILD_COMMAND: { schema: (input) => input }
});
