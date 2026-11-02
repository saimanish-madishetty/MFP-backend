import { BadRequestException, Injectable, PipeTransform } from '@nestjs/common';

/** Validates an optional "YYYY-MM-DD" query parameter (undefined passes through). */
@Injectable()
export class ParseDateOnlyPipe implements PipeTransform<string | undefined> {
  transform(value: string | undefined) {
    if (value === undefined || value === '') return undefined;
    if (!/^\d{4}-\d{2}-\d{2}$/.test(value) || isNaN(Date.parse(value))) {
      throw new BadRequestException('Date must be YYYY-MM-DD');
    }
    return value;
  }
}
