// Enabled only by the benchmark. Normal rendering does not issue queries/readbacks.
export class GpuTimer {
    enabled = false;
    private querySet?: GPUQuerySet;
    private resolveBuffer?: GPUBuffer;
    private readBuffer?: GPUBuffer;
    private labels: string[] = [];
    constructor(device: GPUDevice) {
        if (!device.features.has('timestamp-query')) return;
        this.querySet = device.createQuerySet({ type: 'timestamp', count: 8 });
        this.resolveBuffer = device.createBuffer({ size: 64, usage: GPUBufferUsage.QUERY_RESOLVE | GPUBufferUsage.COPY_SRC });
        this.readBuffer = device.createBuffer({ size: 64, usage: GPUBufferUsage.COPY_DST | GPUBufferUsage.MAP_READ });
    }
    begin() { this.labels = []; }
    pass(label: string): GPUComputePassTimestampWrites | undefined {
        if (!this.enabled || !this.querySet) return undefined;
        const index = this.labels.length * 2;
        if (index >= 8) throw new Error('Too many timed passes');
        this.labels.push(label);
        return { querySet: this.querySet, beginningOfPassWriteIndex: index, endOfPassWriteIndex: index + 1 };
    }
    resolve(encoder: GPUCommandEncoder) {
        if (!this.enabled || !this.querySet || !this.labels.length) return;
        encoder.resolveQuerySet(this.querySet, 0, this.labels.length * 2, this.resolveBuffer!, 0);
        encoder.copyBufferToBuffer(this.resolveBuffer!, 0, this.readBuffer!, 0, this.labels.length * 16);
    }
    async read(): Promise<Record<string, number>> {
        if (!this.enabled || !this.querySet) return {};
        await this.readBuffer!.mapAsync(GPUMapMode.READ);
        const values = new BigUint64Array(this.readBuffer!.getMappedRange());
        const result: Record<string, number> = {};
        this.labels.forEach((label, i) => result[label] = Number(values[i * 2 + 1] - values[i * 2]) / 1e6);
        this.readBuffer!.unmap();
        return result;
    }
}
