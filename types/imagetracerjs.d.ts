declare module "imagetracerjs" {
  type Options = Record<string, unknown>;

  const ImageTracer: {
    imagedataToSVG: (imageData: ImageData, options?: Options) => string;
    imageToSVG: (
      url: string,
      callback: (svg: string) => void,
      options?: Options,
    ) => void;
  };

  export default ImageTracer;
}
