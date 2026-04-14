import { Metadata, type ServiceError, status } from "@grpc/grpc-js";
import { describe, expect, it } from "vitest";
import {
	AlreadyExistsError,
	ChecksumMismatchError,
	DecreeError,
	IncompatibleServerError,
	InvalidArgumentError,
	LockedError,
	NotFoundError,
	PermissionDeniedError,
	TypeMismatchError,
	UnavailableError,
	mapGrpcError,
} from "../src/errors.js";

function makeServiceError(code: number, details: string): ServiceError {
	const err = new Error(details) as ServiceError;
	err.code = code;
	err.details = details;
	err.metadata = new Metadata();
	return err;
}

describe("error hierarchy", () => {
	it("DecreeError is an Error", () => {
		const err = new DecreeError("test");
		expect(err).toBeInstanceOf(Error);
		expect(err).toBeInstanceOf(DecreeError);
		expect(err.message).toBe("test");
		expect(err.name).toBe("DecreeError");
	});

	it("DecreeError stores gRPC status code", () => {
		const err = new DecreeError("test", status.INTERNAL);
		expect(err.code).toBe(status.INTERNAL);
	});

	it("DecreeError code is optional", () => {
		const err = new DecreeError("test");
		expect(err.code).toBeUndefined();
	});

	it("subclasses extend DecreeError", () => {
		const classes = [
			NotFoundError,
			AlreadyExistsError,
			InvalidArgumentError,
			LockedError,
			ChecksumMismatchError,
			PermissionDeniedError,
			UnavailableError,
		] as const;

		for (const Cls of classes) {
			const err = new Cls("msg", status.UNKNOWN);
			expect(err).toBeInstanceOf(DecreeError);
			expect(err).toBeInstanceOf(Error);
			expect(err.message).toBe("msg");
			expect(err.code).toBe(status.UNKNOWN);
		}
	});

	it("IncompatibleServerError has no code", () => {
		const err = new IncompatibleServerError("bad version");
		expect(err).toBeInstanceOf(DecreeError);
		expect(err.code).toBeUndefined();
		expect(err.name).toBe("IncompatibleServerError");
	});

	it("TypeMismatchError has no code", () => {
		const err = new TypeMismatchError("bad type");
		expect(err).toBeInstanceOf(DecreeError);
		expect(err.code).toBeUndefined();
		expect(err.name).toBe("TypeMismatchError");
	});
});

describe("mapGrpcError", () => {
	it("maps NOT_FOUND to NotFoundError", () => {
		const err = mapGrpcError(makeServiceError(status.NOT_FOUND, "not found"));
		expect(err).toBeInstanceOf(NotFoundError);
		expect(err.code).toBe(status.NOT_FOUND);
		expect(err.message).toBe("not found");
	});

	it("maps ALREADY_EXISTS to AlreadyExistsError", () => {
		const err = mapGrpcError(makeServiceError(status.ALREADY_EXISTS, "exists"));
		expect(err).toBeInstanceOf(AlreadyExistsError);
	});

	it("maps INVALID_ARGUMENT to InvalidArgumentError", () => {
		const err = mapGrpcError(makeServiceError(status.INVALID_ARGUMENT, "bad arg"));
		expect(err).toBeInstanceOf(InvalidArgumentError);
	});

	it("maps FAILED_PRECONDITION to LockedError", () => {
		const err = mapGrpcError(makeServiceError(status.FAILED_PRECONDITION, "locked"));
		expect(err).toBeInstanceOf(LockedError);
	});

	it("maps ABORTED to ChecksumMismatchError", () => {
		const err = mapGrpcError(makeServiceError(status.ABORTED, "checksum mismatch"));
		expect(err).toBeInstanceOf(ChecksumMismatchError);
	});

	it("maps PERMISSION_DENIED to PermissionDeniedError", () => {
		const err = mapGrpcError(makeServiceError(status.PERMISSION_DENIED, "denied"));
		expect(err).toBeInstanceOf(PermissionDeniedError);
	});

	it("maps UNAUTHENTICATED to PermissionDeniedError", () => {
		const err = mapGrpcError(makeServiceError(status.UNAUTHENTICATED, "unauth"));
		expect(err).toBeInstanceOf(PermissionDeniedError);
	});

	it("maps UNAVAILABLE to UnavailableError", () => {
		const err = mapGrpcError(makeServiceError(status.UNAVAILABLE, "unavailable"));
		expect(err).toBeInstanceOf(UnavailableError);
	});

	it("maps unknown codes to generic DecreeError", () => {
		const err = mapGrpcError(makeServiceError(status.INTERNAL, "internal error"));
		expect(err).toBeInstanceOf(DecreeError);
		expect(err).not.toBeInstanceOf(NotFoundError);
		expect(err.code).toBe(status.INTERNAL);
	});

	it("uses details as message, falls back to error message", () => {
		const withDetails = makeServiceError(status.INTERNAL, "detail msg");
		expect(mapGrpcError(withDetails).message).toBe("detail msg");

		const noDetails = new Error("fallback") as ServiceError;
		noDetails.code = status.INTERNAL;
		noDetails.details = "";
		noDetails.metadata = new Metadata();
		expect(mapGrpcError(noDetails).message).toBe("fallback");
	});
});
