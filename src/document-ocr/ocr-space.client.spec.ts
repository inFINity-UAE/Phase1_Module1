import { BadRequestException } from '@nestjs/common';
import { textFromOcrSpace } from './ocr-space.client';

describe('OCR.space response', () => {
  it('returns the parsed text', () => {
    expect(
      textFromOcrSpace({
        IsErroredOnProcessing: false,
        ParsedResults: [{ FileParseExitCode: 1, ParsedText: 'Invoice 100\nTotal 105.00' }],
      }),
    ).toBe('Invoice 100\nTotal 105.00');
  });

  it('rejects a processing error from the provider', () => {
    expect(() =>
      textFromOcrSpace({
        IsErroredOnProcessing: true,
        ErrorMessage: ['File type is not supported'],
      }),
    ).toThrow(BadRequestException);
  });
});
