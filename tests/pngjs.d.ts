// pngjs 最小类型声明(devDependency,仅测试像素读数用;无官方 @types 包)
declare module 'pngjs' {
  export class PNG {
    static sync: {
      read(path: string): PNG;
      read(buffer: Buffer): PNG;
    };
    width: number;
    height: number;
    data: Buffer;
  }
}
