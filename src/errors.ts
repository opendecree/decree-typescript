/**
 * Exception hierarchy for the OpenDecree SDK.
 *
 * Maps gRPC status codes to typed Error subclasses.
 */

import { type ServiceError, status } from "@grpc/grpc-js";

/** Base error for all OpenDecree SDK errors. */
export class DecreeError extends Error {
	readonly code?: (typeof status)[keyof typeof status];

	constructor(
		message: string,
		code?: (typeof status)[keyof typeof status],
		options?: ErrorOptions,
	) {
		super(message, options);
		this.name = "DecreeError";
		this.code = code;
	}

	toJSON(): Record<string, unknown> {
		return {
			name: this.name,
			message: this.message,
			code: this.code,
		};
	}
}

/** Raised when a requested resource does not exist. */
export class NotFoundError extends DecreeError {
	constructor(
		message: string,
		code?: (typeof status)[keyof typeof status],
		options?: ErrorOptions,
	) {
		super(message, code, options);
		this.name = "NotFoundError";
	}
}

/** Raised when attempting to create a resource that already exists. */
export class AlreadyExistsError extends DecreeError {
	constructor(
		message: string,
		code?: (typeof status)[keyof typeof status],
		options?: ErrorOptions,
	) {
		super(message, code, options);
		this.name = "AlreadyExistsError";
	}
}

/** Raised when a request contains invalid arguments. */
export class InvalidArgumentError extends DecreeError {
	constructor(
		message: string,
		code?: (typeof status)[keyof typeof status],
		options?: ErrorOptions,
	) {
		super(message, code, options);
		this.name = "InvalidArgumentError";
	}
}

/** Raised when a field is locked and cannot be modified. */
export class LockedError extends DecreeError {
	constructor(
		message: string,
		code?: (typeof status)[keyof typeof status],
		options?: ErrorOptions,
	) {
		super(message, code, options);
		this.name = "LockedError";
	}
}

/** Raised when an optimistic concurrency check fails. */
export class ChecksumMismatchError extends DecreeError {
	constructor(
		message: string,
		code?: (typeof status)[keyof typeof status],
		options?: ErrorOptions,
	) {
		super(message, code, options);
		this.name = "ChecksumMismatchError";
	}
}

/** Raised when the caller lacks permission for the operation. */
export class PermissionDeniedError extends DecreeError {
	constructor(
		message: string,
		code?: (typeof status)[keyof typeof status],
		options?: ErrorOptions,
	) {
		super(message, code, options);
		this.name = "PermissionDeniedError";
	}
}

/** Raised when the server is unavailable. */
export class UnavailableError extends DecreeError {
	constructor(
		message: string,
		code?: (typeof status)[keyof typeof status],
		options?: ErrorOptions,
	) {
		super(message, code, options);
		this.name = "UnavailableError";
	}
}

/** Raised when a quota or rate limit has been exceeded. */
export class ResourceExhaustedError extends DecreeError {
	constructor(
		message: string,
		code?: (typeof status)[keyof typeof status],
		options?: ErrorOptions,
	) {
		super(message, code, options);
		this.name = "ResourceExhaustedError";
	}
}

/** Raised when unrecoverable data loss or corruption is detected. */
export class DataLossError extends DecreeError {
	constructor(
		message: string,
		code?: (typeof status)[keyof typeof status],
		options?: ErrorOptions,
	) {
		super(message, code, options);
		this.name = "DataLossError";
	}
}

/** Raised when a value is out of the valid range. */
export class OutOfRangeError extends DecreeError {
	constructor(
		message: string,
		code?: (typeof status)[keyof typeof status],
		options?: ErrorOptions,
	) {
		super(message, code, options);
		this.name = "OutOfRangeError";
	}
}

/** Raised when an operation was cancelled by the caller. */
export class CancelledError extends DecreeError {
	constructor(
		message: string,
		code?: (typeof status)[keyof typeof status],
		options?: ErrorOptions,
	) {
		super(message, code, options);
		this.name = "CancelledError";
	}
}

/** Raised when an operation is not implemented by the server. */
export class UnimplementedError extends DecreeError {
	constructor(
		message: string,
		code?: (typeof status)[keyof typeof status],
		options?: ErrorOptions,
	) {
		super(message, code, options);
		this.name = "UnimplementedError";
	}
}

/** Raised when a deadline expired before the operation completed. */
export class DeadlineExceededError extends DecreeError {
	constructor(
		message: string,
		code?: (typeof status)[keyof typeof status],
		options?: ErrorOptions,
	) {
		super(message, code, options);
		this.name = "DeadlineExceededError";
	}
}

/** Raised when the server version is incompatible with this SDK. */
export class IncompatibleServerError extends DecreeError {
	constructor(message: string) {
		super(message);
		this.name = "IncompatibleServerError";
	}
}

/** Raised when a typed getter receives a value of the wrong type. */
export class TypeMismatchError extends DecreeError {
	constructor(message: string) {
		super(message);
		this.name = "TypeMismatchError";
	}
}

const STATUS_MAP: ReadonlyMap<
	number,
	new (
		msg: string,
		code: number,
		opts: ErrorOptions,
	) => DecreeError
> = new Map([
	[status.NOT_FOUND, NotFoundError],
	[status.ALREADY_EXISTS, AlreadyExistsError],
	[status.INVALID_ARGUMENT, InvalidArgumentError],
	[status.FAILED_PRECONDITION, LockedError],
	[status.ABORTED, ChecksumMismatchError],
	[status.PERMISSION_DENIED, PermissionDeniedError],
	[status.UNAUTHENTICATED, PermissionDeniedError],
	[status.UNAVAILABLE, UnavailableError],
	[status.RESOURCE_EXHAUSTED, ResourceExhaustedError],
	[status.DATA_LOSS, DataLossError],
	[status.OUT_OF_RANGE, OutOfRangeError],
	[status.CANCELLED, CancelledError],
	[status.UNIMPLEMENTED, UnimplementedError],
	[status.DEADLINE_EXCEEDED, DeadlineExceededError],
]);

/** Convert a gRPC ServiceError to a typed DecreeError. */
export function mapGrpcError(err: ServiceError): DecreeError {
	const ErrorClass = STATUS_MAP.get(err.code);
	const message = err.details || err.message;
	if (ErrorClass) {
		return new ErrorClass(message, err.code, { cause: err });
	}
	return new DecreeError(message, err.code, { cause: err });
}
