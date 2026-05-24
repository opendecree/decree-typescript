import { Metadata, type ServiceError, status } from "@grpc/grpc-js";
import { describe, expect, it } from "vitest";
import {
	AlreadyExistsError,
	CancelledError,
	ChecksumMismatchError,
	DataLossError,
	DeadlineExceededError,
	DecreeError,
	IncompatibleServerError,
	InvalidArgumentError,
	LockedError,
	mapGrpcError,
	NotFoundError,
	OutOfRangeError,
	PermissionDeniedError,
	ResourceExhaustedError,
	TypeMismatchError,
	UnavailableError,
	UnimplementedError,
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

	it("DecreeError toJSON includes name, message, code", () => {
		const err = new DecreeError("msg", status.INTERNAL);
		expect(err.toJSON()).toEqual({ name: "DecreeError", message: "msg", code: status.INTERNAL });
	});

	it("DecreeError toJSON code is undefined when not set", () => {
		const err = new DecreeError("msg");
		expect(err.toJSON()).toEqual({ name: "DecreeError", message: "msg", code: undefined });
	});

	it("subclass toJSON reflects subclass name", () => {
		const err = new NotFoundError("gone", status.NOT_FOUND);
		expect(err.toJSON()).toMatchObject({ name: "NotFoundError", code: status.NOT_FOUND });
	});

	it("original subclasses extend DecreeError", () => {
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

	it("new typed subclasses extend DecreeError", () => {
		const classes = [
			ResourceExhaustedError,
			DataLossError,
			OutOfRangeError,
			CancelledError,
			UnimplementedError,
			DeadlineExceededError,
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

	it("maps RESOURCE_EXHAUSTED to ResourceExhaustedError", () => {
		const err = mapGrpcError(makeServiceError(status.RESOURCE_EXHAUSTED, "quota exceeded"));
		expect(err).toBeInstanceOf(ResourceExhaustedError);
		expect(err.code).toBe(status.RESOURCE_EXHAUSTED);
	});

	it("maps DATA_LOSS to DataLossError", () => {
		const err = mapGrpcError(makeServiceError(status.DATA_LOSS, "data lost"));
		expect(err).toBeInstanceOf(DataLossError);
		expect(err.code).toBe(status.DATA_LOSS);
	});

	it("maps OUT_OF_RANGE to OutOfRangeError", () => {
		const err = mapGrpcError(makeServiceError(status.OUT_OF_RANGE, "out of range"));
		expect(err).toBeInstanceOf(OutOfRangeError);
		expect(err.code).toBe(status.OUT_OF_RANGE);
	});

	it("maps CANCELLED to CancelledError", () => {
		const err = mapGrpcError(makeServiceError(status.CANCELLED, "cancelled"));
		expect(err).toBeInstanceOf(CancelledError);
		expect(err.code).toBe(status.CANCELLED);
	});

	it("maps UNIMPLEMENTED to UnimplementedError", () => {
		const err = mapGrpcError(makeServiceError(status.UNIMPLEMENTED, "not implemented"));
		expect(err).toBeInstanceOf(UnimplementedError);
		expect(err.code).toBe(status.UNIMPLEMENTED);
	});

	it("maps DEADLINE_EXCEEDED to DeadlineExceededError", () => {
		const err = mapGrpcError(makeServiceError(status.DEADLINE_EXCEEDED, "deadline exceeded"));
		expect(err).toBeInstanceOf(DeadlineExceededError);
		expect(err.code).toBe(status.DEADLINE_EXCEEDED);
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

	it("chains cause from original gRPC error", () => {
		const grpcErr = makeServiceError(status.NOT_FOUND, "not found");
		const err = mapGrpcError(grpcErr);
		expect((err as Error & { cause: unknown }).cause).toBe(grpcErr);
	});

	it("generic DecreeError also chains cause", () => {
		const grpcErr = makeServiceError(status.INTERNAL, "internal");
		const err = mapGrpcError(grpcErr);
		expect((err as Error & { cause: unknown }).cause).toBe(grpcErr);
	});
});
