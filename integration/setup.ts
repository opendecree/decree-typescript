/**
 * Global setup for integration tests.
 *
 * Creates a schema + tenant before all tests, sets initial values, then
 * tears everything down afterward. The tenantId and serverAddr are
 * provided to tests via Vitest's inject() mechanism.
 */

import { credentials, Metadata, type ServiceError } from "@grpc/grpc-js";
import type { GlobalSetupContext } from "vitest/node";
import { ConfigClient } from "../src/client.js";
import { ConfigServiceClient } from "../src/generated/centralconfig/v1/config_service.js";
import { SchemaServiceClient } from "../src/generated/centralconfig/v1/schema_service.js";
import { FieldType } from "../src/generated/centralconfig/v1/types.js";

declare module "vitest" {
	interface ProvidedContext {
		tenantId: string;
		schemaId: string;
		serverAddr: string;
	}
}

function promisify<Req, Res>(
	fn: (req: Req, meta: Metadata, cb: (err: ServiceError | null, res: Res) => void) => void,
	req: Req,
	meta: Metadata,
): Promise<Res> {
	return new Promise((resolve, reject) => {
		fn(req, meta, (err, res) => {
			if (err) reject(err);
			else resolve(res as Res);
		});
	});
}

export async function setup({ provide }: GlobalSetupContext) {
	const serverAddr = process.env.DECREE_SERVER_ADDR ?? "localhost:9090";
	const creds = credentials.createInsecure();

	const meta = new Metadata();
	meta.set("x-subject", "integration-test");
	meta.set("x-role", "superadmin");

	const schemaClient = new SchemaServiceClient(serverAddr, creds);

	// Wait up to 30s for the server to accept gRPC connections.
	await new Promise<void>((resolve, reject) => {
		schemaClient.waitForReady(new Date(Date.now() + 30_000), (err) => {
			if (err) reject(new Error(`server not ready at ${serverAddr}: ${err.message}`));
			else resolve();
		});
	});

	const schemaName = `ts-sdk-int-${Date.now()}`;
	const { schema } = await promisify(
		schemaClient.createSchema.bind(schemaClient),
		{
			name: schemaName,
			description: "TypeScript SDK integration test schema",
			fields: [
				{
					path: "app.fee",
					type: FieldType.FIELD_TYPE_STRING,
					constraints: undefined,
					nullable: true,
					deprecated: false,
					examples: {},
					tags: [],
				},
				{
					path: "app.count",
					type: FieldType.FIELD_TYPE_INT,
					constraints: undefined,
					nullable: false,
					deprecated: false,
					examples: {},
					tags: [],
				},
				{
					path: "app.enabled",
					type: FieldType.FIELD_TYPE_BOOL,
					constraints: undefined,
					nullable: false,
					deprecated: false,
					examples: {},
					tags: [],
				},
			],
		},
		meta,
	);
	if (!schema) throw new Error("createSchema returned no schema");
	const schemaId = schema.id;

	await promisify(
		schemaClient.publishSchema.bind(schemaClient),
		{ id: schemaId, version: 1 },
		meta,
	);

	const tenantName = `ts-sdk-tenant-${Date.now()}`;
	const { tenant } = await promisify(
		schemaClient.createTenant.bind(schemaClient),
		{ name: tenantName, schemaId, schemaVersion: 1 },
		meta,
	);
	if (!tenant) throw new Error("createTenant returned no tenant");
	const tenantId = tenant.id;

	const configClient = new ConfigClient(serverAddr, {
		insecure: true,
		subject: "integration-test",
		role: "superadmin",
		retry: false,
	});
	const rawConfig = new ConfigServiceClient(serverAddr, creds);
	await configClient.set(tenantId, "app.fee", "0.5%");
	await promisify(
		rawConfig.setField.bind(rawConfig),
		{ tenantId, fieldPath: "app.count", value: { integerValue: 42 } },
		meta,
	);
	await configClient.setBool(tenantId, "app.enabled", true);
	configClient.close();
	rawConfig.close();

	provide("tenantId", tenantId);
	provide("schemaId", schemaId);
	provide("serverAddr", serverAddr);

	return async () => {
		await promisify(schemaClient.deleteTenant.bind(schemaClient), { id: tenantId }, meta);
		await promisify(schemaClient.deleteSchema.bind(schemaClient), { id: schemaId }, meta);
		schemaClient.close();
	};
}
