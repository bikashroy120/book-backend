declare module 'xss' {
  type FilterXSSOptions = {
    stripIgnoreTagBody?: string[];
  };

  function filterXSS(input: string, options?: FilterXSSOptions): string;

  export = filterXSS;
}
