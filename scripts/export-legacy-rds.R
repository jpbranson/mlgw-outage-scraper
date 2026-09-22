# Base-R, offline reader for the two explicitly supported legacy schemas.
# Does not source legacy code, restore workspaces, or load credential/config files.
args <- commandArgs(trailingOnly=TRUE)
if (length(args) != 3L) stop('Usage: Rscript --vanilla scripts/export-legacy-rds.R totals|polygons input.rds output-directory')
kind <- args[[1L]]; input <- args[[2L]]; output <- args[[3L]]
if (!(kind %in% c('totals', 'polygons'))) stop('Unsupported schema')
if (file.info(input)$size > 128 * 1024^2) stop('Input exceeds 128 MiB bound')
dir.create(output, recursive=TRUE, showWarnings=FALSE)
x <- readRDS(input)
if (!inherits(x, 'data.frame') || nrow(x) > 5000000L) stop('Unsupported table or row bound')
class(x) <- 'data.frame'
write_csv <- function(value, name) {
  connection <- gzfile(file.path(output, paste0(name, '.gz')), 'wt', encoding='UTF-8', compression=6)
  on.exit(close(connection))
  write.table(value, connection, sep=',', row.names=FALSE, col.names=TRUE, quote=TRUE, na='', eol='\n')
}
if (kind == 'totals') {
  expected <- c('V1','V2','V3','V4','V5','V6','outage_num','cust_affected','time')
  if (!identical(names(x), expected) || !all(vapply(x, is.character, logical(1)))) stop('Unexpected total schema')
  fields <- c('time', 'outage_num', 'cust_affected')
  summary <- unique(x[fields])
  key <- function(y) do.call(paste, c(y[fields], sep='\034'))
  if (any(vapply(x[fields], function(v) any(grepl('\034', v, fixed=TRUE), na.rm=TRUE), logical(1)))) stop('Key separator present')
  summary$source_rows <- tabulate(match(key(x), key(summary)), nbins=nrow(summary))
  summary$first_source_row <- match(key(summary), key(x))
  write_csv(summary, 'totals.csv')
  write_csv(data.frame(kind=kind, source_rows=nrow(x), exported_rows=nrow(summary),
    missing_time=sum(is.na(x$time))), 'metadata.csv')
} else {
  expected <- c('value','long','lat','polygon','id','cust_affected_html','custs_num','y','filename')
  if (!identical(names(x), expected) || !is.numeric(x$long) || !is.numeric(x$lat)) stop('Unexpected polygon schema')
  good <- is.finite(x$long) & is.finite(x$lat)
  vertices <- x[good, ]
  vertices$source_row <- which(good)
  # Keep every original vertex in original row order, including the closing vertex.
  write_csv(vertices, 'vertices.csv')
  omitted <- x[!good, c('filename','id','custs_num')]
  write_csv(unique(omitted), 'nonspatial.csv')
  write_csv(data.frame(kind=kind, source_rows=nrow(x), exported_rows=nrow(vertices),
    nonfinite_coordinate_rows=sum(!good),
    known_nonspatial_filenames=length(unique(omitted$filename[!is.na(omitted$filename)]))), 'metadata.csv')
}
cat(kind, 'source rows', nrow(x), 'exported to', output, '\n')
