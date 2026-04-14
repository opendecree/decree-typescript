/**
 * Exception hierarchy for the OpenDecree SDK.
 *
 * Maps gRPC status codes to typed Error subclasses.
 */

import { type ServiceError, status } from "@grpc/grpc-js";

/** Base error for all OpenDecree SDK errors. */
export class DecreeError extends Error {
	readonly code?: (typeof status)[keyof typeof status];

	constructor(message: string, code?: (typeof status)[keyof typeof status]) {
		super(message);
		this.name = "DecreeError";
		this.code = code;
	}
}

/** Raised when a requested resource does not exist. */
export class NotFoundError extends DecreeError {
	constructor(message: string, code?: (typeof status)[keyof typeof status]) {
		super(message, code);
		this.name = "NotFoundError";
	}
}

/** Raised when attempting to create a resource that already exists. */
export class AlreadyExistsError extends DecreeError {
	constructor(message: string, code?: (typeof status)[keyof typeof status]) {
		super(message, code);
		this.name = "AlreadyExistsError";
	}
}

/** Raised when a request contains invalid arguments. */
export class InvalidArgumentError extends DecreeError {
	constructor(message: string, code?: (typeof status)[keyof typeof status]) {
		super(message, code);
		this.name = "InvalidArgumentError";
	}
}

/** Raised when a field is locked and cannot be modified. */
export class LockedError extends DecreeError {
	constructor(message: string, code?: (typeof status)[keyof typeof status]) {
		super(message, code);
		this.name = "LockedError";
	}
}

/** Raised when an optimistic concurrency check fails. */
export class ChecksumMismatchError extends DecreeError {
	constructor(message: string, code?: (typeof status)[keyof typeof status]) {
		super(message, code);
		this.name = "ChecksumMismatchError";
	}
}

/** Raised when the caller lacks permission for the operation. */
export class PermissionDeniedError extends DecreeError {
	constructor(message: string, code?: (typeof status)[keyof typeof status]) {
		super(message, code);
		this.name = "PermissionDeniedError";
	}
}

/** Raised when the server is unavailable. */
export class UnavailableError extends DecreeError {
	constructor(message: string, code?: (typeof status)[keyof typeof status]) {
		super(message, code);
		this.name = "UnavailableError";
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

const STATUS_MAP: ReadonlyMap<number, new (msg: string, code: number) => DecreeError> = new Map([
	[status.NOT_FOUND, NotFoundError],
	[status.ALREADY_EXISTS, AlreadyExistsError],
	[status.INVALID_ARGUMENT, InvalidArgumentError],
	[status.FAILED_PRECONDITION, LockedError],
	[status.ABORTED, ChecksumMismatchError],
	[status.PERMISSION_DENIED, PermissionDeniedError],
	[status.UNAUTHENTICATED, PermissionDeniedError],
	[status.UNAVAILABLE, UnavailableError],
]);

/** Convert a gRPC ServiceError to a typed DecreeError. */
export function mapGrpcError(err: ServiceError): DecreeError {
	const ErrorClass = STATUS_MAP.get(err.code);
	const message = err.details || err.message;
	if (ErrorClass) {
		return new ErrorClass(message, err.code);
	}
	return new DecreeError(message, err.code);
}
