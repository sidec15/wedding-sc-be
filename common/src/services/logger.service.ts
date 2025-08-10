import { EOL } from "os";
import winston from "winston";

export type LogCallback = (error?: Error | null, level?: string, message?: string, meta?: any) => void;

const { combine, timestamp, errors } = winston.format;

export type ILogMetadata = { [key: string]: any };

export abstract class ILogger {
  abstract getInnerLogger(): winston.Logger;
  abstract getMetadata(): { [key: string]: any };
  abstract addMetadata(key: string, value: any): void;
  abstract isSillyEnabled(): boolean;
  abstract isDebugEnabled(): boolean;
  abstract error(message: string, callback: LogCallback): winston.Logger;
  abstract error(
    message: string,
    meta: any,
    callback: LogCallback
  ): winston.Logger;
  abstract error(message: string, ...meta: any[]): winston.Logger;
  abstract error(message: any): winston.Logger;
  abstract error(infoObject: object): winston.Logger;
  abstract warn(message: string, callback: LogCallback): winston.Logger;
  abstract warn(
    message: string,
    meta: any,
    callback: LogCallback
  ): winston.Logger;
  abstract warn(message: string, ...meta: any[]): winston.Logger;
  abstract warn(message: any): winston.Logger;
  abstract warn(infoObject: object): winston.Logger;
  abstract info(message: string, callback: LogCallback): winston.Logger;
  abstract info(
    message: string,
    meta: any,
    callback: LogCallback
  ): winston.Logger;
  abstract info(message: string, ...meta: any[]): winston.Logger;
  abstract info(message: any): winston.Logger;
  abstract info(infoObject: object): winston.Logger;
  abstract debug(message: string, callback: LogCallback): winston.Logger;
  abstract debug(
    message: string,
    meta: any,
    callback: LogCallback
  ): winston.Logger;
  abstract debug(message: string, ...meta: any[]): winston.Logger;
  abstract debug(message: any): winston.Logger;
  abstract debug(infoObject: object): winston.Logger;
  abstract silly(message: string, callback: LogCallback): winston.Logger;
  abstract silly(
    message: string,
    meta: any,
    callback: LogCallback
  ): winston.Logger;
  abstract silly(message: string, ...meta: any[]): winston.Logger;
  abstract silly(message: any): winston.Logger;
  abstract silly(infoObject: object): winston.Logger;
}

const appSettings = {
  // Log level (default: 'info')
  logLevel: process.env.LOG_LEVEL || 'info',
  
  // Whether to log in single line format (default: false)
  isLogSingleLine: process.env.LOG_SINGLE_LINE === 'true',
  
  // Whether to silence all logs (default: false)
  isLogSilent: process.env.LOG_SILENT === 'true'
} as const;

export class Logger implements ILogger {
  private _logger: winston.Logger;

  private _metadata: { [key: string]: any };

  constructor() {
    this._metadata = {};
    const myFormat = winston.format.printf((info) => {
      // print out http error code w/ a space if we have one
      // const httpErrorCode = code ? ` ${code} - ` : '';
      // print the stack if we have it, message otherwise.
      // message = error || message;
      let message = info.message as string;
      let log = `${info.timestamp} | [${info.level}]`;
      // add request id and user header
      if (this._metadata) {
        for (const key in this._metadata) {
          if(this._metadata[key]){
            log = `${log} | ${key}:${this._metadata[key]}`;
          }
        }
      }

      if (info.stack) {
        let stack = (info.stack as string);
        const regexp = /(?<=Error: )(.*)(?=\n)/g;
        const matches = stack.match(regexp) as string[];
        if (matches?.length > 0) {
          const stackMessage = matches[0];
          if ((message as string).endsWith(stackMessage)) {
            message = message.substring(
              0,
              message.length - stackMessage.length - 1
            );
          }
        }
        stack.replace("Error: ", "");
        if (!stack.startsWith(message)) {
          if (appSettings.isLogSingleLine) {
            message = message.replace(/\n/g, " --> ");
          }
          log = `${log} | ${message}`;
        }
        if (appSettings.isLogSingleLine) {
          const stack2 = (info.stack as string).replace(/\n/g, " --> ");
          log = `${log} | ${stack2}`;
        } else log = `${log}${EOL}${info.stack}`;
      } else {
        if (appSettings.isLogSingleLine) {
          message = message.replace(/\n/g, " --> ");
          log = `${log} | ${message}`;
        } else log = `${log}${EOL}    ${message}`;
      }

      return log;
    });

    const transportConsole = new winston.transports.Console({
      format: combine(timestamp(), myFormat),
    });
    this._logger = winston.createLogger({
      level:
        (appSettings.logLevel && appSettings.logLevel.toLowerCase()) || "info",
      // defaultMeta: { service: 'user-service' },
      // format: winston.format.json(),
      format: errors({ stack: true }),
      transports: [
        //
        // - Write all logs with level `error` and below to `error.log`
        // - Write all logs with level `info` and below to `combined.log`
        //
        // new winston.transports.File({ filename: 'error.log', level: 'error' }),
        // new winston.transports.File({ filename: 'combined.log' }),
        transportConsole,
      ],
    });

    this._logger.silent = appSettings.isLogSilent;

    // logger.error("###################### error");
    // logger.warn("###################### warn");
    // logger.info("###################### info");
    // logger.http("###################### http");
    // logger.verbose("###################### verbose");
    // logger.debug("###################### debug");
    // logger.silly("###################### silly");
  }

  public getMetadata(): { [key: string]: any } {
    return this._metadata;
  }

  public addMetadata(key: string, value: any) {
    this._metadata[key] = value;
  }

  public getInnerLogger() {
    return this._logger;
  }

  public isSillyEnabled(): boolean {
    return this._logger.isSillyEnabled();
  }

  public isDebugEnabled(): boolean {
    return this._logger.isDebugEnabled();
  }

  error(message: string, callback: LogCallback): winston.Logger;
  error(message: string, meta: any, callback: LogCallback): winston.Logger;
  error(message: string, ...meta: any[]): winston.Logger;
  error(message: any): winston.Logger;
  error(infoObject: object): winston.Logger;
  error(message: any, meta?: any, callback?: any) {
    return this._logger.error(message, meta, callback);
  }
  warn(message: string, callback: LogCallback): winston.Logger;
  warn(message: string, meta: any, callback: LogCallback): winston.Logger;
  warn(message: string, ...meta: any[]): winston.Logger;
  warn(message: any): winston.Logger;
  warn(infoObject: object): winston.Logger;
  warn(message: any, meta?: any, callback?: any) {
    return this._logger.warn(message, meta, callback);
  }
  info(message: string, callback: LogCallback): winston.Logger;
  info(message: string, meta: any, callback: LogCallback): winston.Logger;
  info(message: string, ...meta: any[]): winston.Logger;
  info(message: any): winston.Logger;
  info(infoObject: object): winston.Logger;
  info(message: any, meta?: any, callback?: any) {
    return this._logger.info(message, meta, callback);
  }
  debug(message: string, callback: LogCallback): winston.Logger;
  debug(message: string, meta: any, callback: LogCallback): winston.Logger;
  debug(message: string, ...meta: any[]): winston.Logger;
  debug(message: any): winston.Logger;
  debug(infoObject: object): winston.Logger;
  debug(message: any, meta?: any, callback?: any) {
    return this._logger.debug(message, meta, callback);
  }
  silly(message: string, callback: LogCallback): winston.Logger;
  silly(message: string, meta: any, callback: LogCallback): winston.Logger;
  silly(message: string, ...meta: any[]): winston.Logger;
  silly(message: any): winston.Logger;
  silly(infoObject: object): winston.Logger;
  silly(message: any, meta?: any, callback?: any) {
    return this._logger.silly(message, meta, callback);
  }
}
